package connection

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestReloadSerializesWithConcurrentConnect(t *testing.T) {
	service := newTestService(t, nil)
	connection, err := service.AddConnection(profileOf("primary", "test", "primary:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	runtime := newBlockingRuntime()
	service.runtime = runtime

	connectDone := make(chan error, 1)
	go func() { connectDone <- service.Connect(connection.ID) }()
	runtime.waitForFirstConnect(t)

	reloadStarted := make(chan struct{})
	reloadDone := make(chan error, 1)
	go func() {
		close(reloadStarted)
		reloadDone <- service.Reload()
	}()
	<-reloadStarted
	assertRuntimeResetBlocked(t, runtime, reloadDone)

	runtime.releaseFirstConnect()
	if err := <-connectDone; err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	if err := <-reloadDone; err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	assertRuntimeMatchesOnlineConnection(t, service, runtime, "primary:9876")
	if got := runtime.connectCount(); got != 2 {
		t.Fatalf("runtime connect calls = %d, want initial connect plus reload reconnect", got)
	}
}

func TestReplaceConnectionsSerializesWithConcurrentConnect(t *testing.T) {
	service := newTestService(t, nil)
	connection, err := service.AddConnection(profileOf("old", "test", "old:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	runtime := newBlockingRuntime()
	service.runtime = runtime

	connectDone := make(chan error, 1)
	go func() { connectDone <- service.Connect(connection.ID) }()
	runtime.waitForFirstConnect(t)

	replaceStarted := make(chan struct{})
	replaceDone := make(chan error, 1)
	go func() {
		close(replaceStarted)
		replaceDone <- service.ReplaceConnections([]*model.ConnectionProfile{{
			ID:         9,
			Name:       "replacement",
			Endpoints:  "replacement:9876",
			TimeoutSec: 5,
			IsDefault:  true,
		}})
	}()
	<-replaceStarted
	assertRuntimeResetBlocked(t, runtime, replaceDone)

	runtime.releaseFirstConnect()
	if err := <-connectDone; err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	if err := <-replaceDone; err != nil {
		t.Fatalf("replace failed: %v", err)
	}
	connections := service.GetConnections()
	if len(connections) != 1 || connections[0].Name != "replacement" {
		t.Fatalf("unexpected replacement state: %#v", connections)
	}
	assertRuntimeMatchesOnlineConnection(t, service, runtime, "replacement:9876")
	if runtime.hasClient("old:9876") {
		t.Fatal("old runtime client survived replacement")
	}
}

func TestConnectionProbeSerializesWithProfileReplacement(t *testing.T) {
	service := newTestService(t, nil)
	connection, err := service.AddConnection(profileOf("old", "test", "old:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	runtime := newBlockingTestRuntime()
	service.runtime = runtime

	testDone := make(chan error, 1)
	go func() {
		_, err := service.TestConnection(connection.ID)
		testDone <- err
	}()
	runtime.waitForTest(t)

	replaceStarted := make(chan struct{})
	replaceDone := make(chan error, 1)
	go func() {
		close(replaceStarted)
		replaceDone <- service.ReplaceConnections([]*model.ConnectionProfile{{
			ID:         connection.ID,
			Name:       "replacement",
			Endpoints:  "replacement:9876",
			TimeoutSec: 5,
			IsDefault:  true,
		}})
	}()
	<-replaceStarted
	select {
	case err := <-replaceDone:
		t.Fatalf("profile replacement interleaved with an in-flight connection test: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	runtime.releaseTest()
	if err := <-testDone; err != nil {
		t.Fatalf("connection test failed: %v", err)
	}
	if err := <-replaceDone; err != nil {
		t.Fatalf("replace failed: %v", err)
	}
	got, err := service.GetConnection(connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "replacement" || got.LastCheck != "-" {
		t.Fatalf("stale connection-test result reached the replacement profile: %#v", got)
	}
}

func assertRuntimeResetBlocked(t *testing.T, runtime *blockingRuntime, operationDone <-chan error) {
	t.Helper()
	select {
	case <-runtime.closeAllCalled:
		t.Fatal("runtime reset interleaved with an in-flight connection transaction")
	case err := <-operationDone:
		t.Fatalf("runtime mutation returned before the in-flight connect completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
}

func assertRuntimeMatchesOnlineConnection(t *testing.T, service *Service, runtime *blockingRuntime, nameServer string) {
	t.Helper()
	connections := service.GetConnections()
	if len(connections) != 1 || connections[0].Status != model.StatusOnline || !connections[0].IsDefault {
		t.Fatalf("connection state is not online and default: %#v", connections)
	}
	if !runtime.hasClient(nameServer) || runtime.defaultConnection() != nameServer {
		t.Fatalf("runtime state does not match connection state: clients=%v default=%q", runtime.clientNames(), runtime.defaultConnection())
	}
}

type blockingRuntime struct {
	mu                  sync.Mutex
	clients             map[string]struct{}
	defaultNameServer   string
	connectCalls        int
	firstConnectStarted chan struct{}
	firstConnectRelease chan struct{}
	closeAllCalled      chan struct{}
	startOnce           sync.Once
	releaseOnce         sync.Once
}

type blockingTestRuntime struct {
	*blockingRuntime
	testStarted chan struct{}
	testRelease chan struct{}
	releaseOnce sync.Once
}

func newBlockingRuntime() *blockingRuntime {
	return &blockingRuntime{
		clients:             make(map[string]struct{}),
		firstConnectStarted: make(chan struct{}),
		firstConnectRelease: make(chan struct{}),
		closeAllCalled:      make(chan struct{}, 1),
	}
}

func newBlockingTestRuntime() *blockingTestRuntime {
	return &blockingTestRuntime{
		blockingRuntime: newBlockingRuntime(),
		testStarted:     make(chan struct{}),
		testRelease:     make(chan struct{}),
	}
}

func (r *blockingRuntime) Connect(nameServer string, _ time.Duration, _ bool, _, _ string) error {
	r.mu.Lock()
	r.connectCalls++
	call := r.connectCalls
	r.mu.Unlock()
	if call == 1 {
		r.startOnce.Do(func() { close(r.firstConnectStarted) })
		<-r.firstConnectRelease
	}
	r.mu.Lock()
	r.clients[nameServer] = struct{}{}
	r.mu.Unlock()
	return nil
}

func (r *blockingRuntime) HasClient(nameServer string) bool {
	return r.hasClient(nameServer)
}

func (r *blockingRuntime) SetDefault(nameServer string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.clients[nameServer]; !exists {
		return fmt.Errorf("runtime client not found: %s", nameServer)
	}
	r.defaultNameServer = nameServer
	return nil
}

func (r *blockingRuntime) Remove(nameServer string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, nameServer)
	if r.defaultNameServer == nameServer {
		r.defaultNameServer = ""
	}
}

func (r *blockingRuntime) Test(string, time.Duration, bool, string, string) error {
	return nil
}

func (r *blockingTestRuntime) Test(string, time.Duration, bool, string, string) error {
	close(r.testStarted)
	<-r.testRelease
	return nil
}

func (r *blockingRuntime) CloseAll() {
	r.mu.Lock()
	r.clients = make(map[string]struct{})
	r.defaultNameServer = ""
	r.mu.Unlock()
	select {
	case r.closeAllCalled <- struct{}{}:
	default:
	}
}

func (r *blockingRuntime) waitForFirstConnect(t *testing.T) {
	t.Helper()
	select {
	case <-r.firstConnectStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the first runtime connect")
	}
}

func (r *blockingTestRuntime) waitForTest(t *testing.T) {
	t.Helper()
	select {
	case <-r.testStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the runtime connection test")
	}
}

func (r *blockingTestRuntime) releaseTest() {
	r.releaseOnce.Do(func() { close(r.testRelease) })
}

func (r *blockingRuntime) releaseFirstConnect() {
	r.releaseOnce.Do(func() { close(r.firstConnectRelease) })
}

func (r *blockingRuntime) connectCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connectCalls
}

func (r *blockingRuntime) hasClient(nameServer string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, exists := r.clients[nameServer]
	return exists
}

func (r *blockingRuntime) defaultConnection() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.defaultNameServer
}

func (r *blockingRuntime) clientNames() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]string, 0, len(r.clients))
	for name := range r.clients {
		result = append(result, name)
	}
	return result
}
