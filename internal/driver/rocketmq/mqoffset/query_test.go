package mqoffset

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/amigoer/rocketmq-admin-go/protocol/remoting"
)

func TestCollectAggregatesQueuesAcrossBrokersConcurrently(t *testing.T) {
	var probe concurrencyProbe
	brokerA := startOffsetServer(t, 10, "", &probe)
	brokerB := startOffsetServer(t, 100, "", &probe)
	route := &admin.TopicRouteData{
		BrokerDatas: []*admin.BrokerData{
			{BrokerName: "broker-a", BrokerAddrs: map[string]string{"0": brokerA}},
			{BrokerName: "broker-b", BrokerAddrs: map[string]string{"0": brokerB}},
		},
		QueueDatas: []*admin.QueueData{
			{BrokerName: "broker-a", ReadQueueNums: 2},
			{BrokerName: "broker-b", ReadQueueNums: 2},
		},
	}
	client := newTestClient(t, startRouteServer(t, route))

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	offsets, err := Collect(ctx, client, "orders")
	if err != nil {
		t.Fatal(err)
	}
	want := []Offset{
		{BrokerName: "broker-a", QueueID: 0, MinOffset: 10, MaxOffset: 20},
		{BrokerName: "broker-a", QueueID: 1, MinOffset: 11, MaxOffset: 21},
		{BrokerName: "broker-b", QueueID: 0, MinOffset: 100, MaxOffset: 110},
		{BrokerName: "broker-b", QueueID: 1, MinOffset: 101, MaxOffset: 111},
	}
	if len(offsets) != len(want) {
		t.Fatalf("offset count = %d, want %d: %#v", len(offsets), len(want), offsets)
	}
	for index := range want {
		if offsets[index] != want[index] {
			t.Fatalf("offset[%d] = %#v, want %#v", index, offsets[index], want[index])
		}
	}
	if probe.maximum.Load() < 2 {
		t.Fatalf("broker queries did not overlap; maximum concurrency = %d", probe.maximum.Load())
	}
}

func TestCollectReturnsErrorWithoutPartialResults(t *testing.T) {
	goodBroker := startOffsetServer(t, 10, "", nil)
	failingBroker := startOffsetServer(t, 0, "injected offset failure", nil)
	route := &admin.TopicRouteData{
		BrokerDatas: []*admin.BrokerData{
			{BrokerName: "broker-good", BrokerAddrs: map[string]string{"0": goodBroker}},
			{BrokerName: "broker-failing", BrokerAddrs: map[string]string{"0": failingBroker}},
		},
		QueueDatas: []*admin.QueueData{
			{BrokerName: "broker-good", ReadQueueNums: 1},
			{BrokerName: "broker-failing", ReadQueueNums: 1},
		},
	}
	client := newTestClient(t, startRouteServer(t, route))

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	offsets, err := Collect(ctx, client, "orders")
	if err == nil || !strings.Contains(err.Error(), "injected offset failure") {
		t.Fatalf("error = %v, want injected broker failure", err)
	}
	if offsets != nil {
		t.Fatalf("partial offsets must not be returned: %#v", offsets)
	}
}

func TestCollectReturnsEmptySliceWhenRouteHasNoReadableQueues(t *testing.T) {
	client := newTestClient(t, startRouteServer(t, &admin.TopicRouteData{}))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	offsets, err := Collect(ctx, client, "empty")
	if err != nil {
		t.Fatal(err)
	}
	if offsets == nil || len(offsets) != 0 {
		t.Fatalf("offsets = %#v, want a non-nil empty slice", offsets)
	}
}

type concurrencyProbe struct {
	current atomic.Int32
	maximum atomic.Int32
}

func (p *concurrencyProbe) enter() func() {
	current := p.current.Add(1)
	for {
		maximum := p.maximum.Load()
		if current <= maximum || p.maximum.CompareAndSwap(maximum, current) {
			break
		}
	}
	time.Sleep(30 * time.Millisecond)
	return func() { p.current.Add(-1) }
}

func newTestClient(t *testing.T, nameServerAddress string) *admin.Client {
	t.Helper()
	client, err := admin.NewClient(
		admin.WithNameServers([]string{nameServerAddress}),
		admin.WithTimeout(2*time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func startRouteServer(t *testing.T, route *admin.TopicRouteData) string {
	t.Helper()
	body, err := json.Marshal(route)
	if err != nil {
		t.Fatal(err)
	}
	return startRemotingServer(t, func(request *remoting.RemotingCommand) *remoting.RemotingCommand {
		if request.Code != remoting.GetRouteInfoByTopic {
			return response(request, remoting.RequestCodeNotSupported, "unexpected request", nil, nil)
		}
		return response(request, remoting.Success, "", nil, body)
	})
}

func startOffsetServer(t *testing.T, baseOffset int64, failure string, probe *concurrencyProbe) string {
	t.Helper()
	return startRemotingServer(t, func(request *remoting.RemotingCommand) *remoting.RemotingCommand {
		if request.Code != remoting.SearchOffsetByTimestamp {
			return response(request, remoting.RequestCodeNotSupported, "unexpected request", nil, nil)
		}
		if probe != nil {
			leave := probe.enter()
			defer leave()
		}
		if failure != "" {
			return response(request, remoting.SystemError, failure, nil, nil)
		}
		queueID, err := strconv.ParseInt(request.ExtFields["queueId"], 10, 64)
		if err != nil {
			return response(request, remoting.SystemError, err.Error(), nil, nil)
		}
		offset := baseOffset + queueID
		if request.ExtFields["timestamp"] != "0" {
			offset += 10
		}
		return response(
			request,
			remoting.Success,
			"",
			map[string]string{"offset": strconv.FormatInt(offset, 10)},
			nil,
		)
	})
}

func response(
	request *remoting.RemotingCommand,
	code int,
	remark string,
	extFields map[string]string,
	body []byte,
) *remoting.RemotingCommand {
	result := &remoting.RemotingCommand{
		Code:      code,
		Language:  remoting.LanguageGo,
		Version:   remoting.CurrentVersion,
		Opaque:    request.Opaque,
		Remark:    remark,
		ExtFields: extFields,
		Body:      body,
	}
	result.MarkResponseType()
	return result
}

type remotingHandler func(*remoting.RemotingCommand) *remoting.RemotingCommand

func startRemotingServer(t *testing.T, handler remotingHandler) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &testRemotingServer{
		listener:   listener,
		handler:    handler,
		acceptDone: make(chan struct{}),
	}
	go server.accept()
	t.Cleanup(server.close)
	return listener.Addr().String()
}

type testRemotingServer struct {
	listener    net.Listener
	handler     remotingHandler
	acceptDone  chan struct{}
	connections sync.Map
	workers     sync.WaitGroup
}

func (s *testRemotingServer) accept() {
	defer close(s.acceptDone)
	for {
		connection, err := s.listener.Accept()
		if err != nil {
			return
		}
		s.connections.Store(connection, struct{}{})
		s.workers.Add(1)
		go s.serve(connection)
	}
}

func (s *testRemotingServer) serve(connection net.Conn) {
	defer s.workers.Done()
	defer s.connections.Delete(connection)
	defer connection.Close()
	for {
		request, err := readCommand(connection)
		if err != nil {
			return
		}
		encoded, err := s.handler(request).Encode()
		if err != nil {
			return
		}
		if _, err := connection.Write(encoded); err != nil {
			return
		}
	}
}

func (s *testRemotingServer) close() {
	_ = s.listener.Close()
	<-s.acceptDone
	s.connections.Range(func(key, _ any) bool {
		_ = key.(net.Conn).Close()
		return true
	})
	s.workers.Wait()
}

func readCommand(reader io.Reader) (*remoting.RemotingCommand, error) {
	var lengthBuffer [4]byte
	if _, err := io.ReadFull(reader, lengthBuffer[:]); err != nil {
		return nil, err
	}
	length := int(binary.BigEndian.Uint32(lengthBuffer[:]))
	if length <= 0 || length > 16*1024*1024 {
		return nil, fmt.Errorf("invalid command length: %d", length)
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	return remoting.Decode(data)
}
