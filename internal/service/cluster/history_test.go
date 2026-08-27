package cluster

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestTPSHistoryPersistsAndCoalescesMinuteSamples(t *testing.T) {
	current := time.Now().UTC().Truncate(time.Minute)
	historyPath := filepath.Join(t.TempDir(), "tps-history.json")
	service := newTPSHistoryTestService(historyPath, &current)

	broker := onlineBroker("127.0.0.1:10911", 10, 4)
	service.recordBrokerTPS([]string{"ns-b:9876", "ns-a:9876"}, []*model.BrokerNode{broker})
	broker.TpsIn = 12
	broker.TpsOut = 5
	service.recordBrokerTPS([]string{"ns-a:9876", "ns-b:9876"}, []*model.BrokerNode{broker})

	if len(broker.TpsInHistory) != 1 || broker.TpsInHistory[0] != 12 {
		t.Fatalf("same-minute history = %#v, want [12]", broker.TpsInHistory)
	}

	current = current.Add(time.Minute)
	broker.TpsIn = 20
	broker.TpsOut = 8
	service.recordBrokerTPS([]string{"ns-a:9876", "ns-b:9876"}, []*model.BrokerNode{broker})

	restored := newTPSHistoryTestService(historyPath, &current)
	if err := restored.loadTPSHistory(); err != nil {
		t.Fatal(err)
	}
	offline := &model.BrokerNode{Address: broker.Address, Status: model.NodeOffline, TpsIn: -1, TpsOut: -1}
	restored.recordBrokerTPS([]string{"ns-b:9876", "ns-a:9876"}, []*model.BrokerNode{offline})

	if len(offline.TpsHistoryTimestamps) != 2 {
		t.Fatalf("restored timestamps = %#v", offline.TpsHistoryTimestamps)
	}
	if offline.TpsInHistory[0] != 12 || offline.TpsInHistory[1] != 20 {
		t.Fatalf("restored inbound history = %#v", offline.TpsInHistory)
	}
	if offline.TpsOutHistory[0] != 5 || offline.TpsOutHistory[1] != 8 {
		t.Fatalf("restored outbound history = %#v", offline.TpsOutHistory)
	}
}

func TestTPSHistoryPrunesSamplesOutsideLastHour(t *testing.T) {
	current := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)
	service := newTPSHistoryTestService("", &current)
	key := tpsHistoryScope([]string{"127.0.0.1:9876"}) + "|127.0.0.1:10911"
	service.history[key] = &brokerTPSHistory{Samples: []brokerTPSSample{
		{Timestamp: current.Add(-60 * time.Minute).Unix(), TpsIn: 1, TpsOut: 1},
		{Timestamp: current.Add(-59 * time.Minute).Unix(), TpsIn: 2, TpsOut: 2},
		{Timestamp: current.Unix(), TpsIn: 3, TpsOut: 3},
	}}

	if !service.pruneTPSHistoryLocked(current.Unix()) {
		t.Fatal("pruneTPSHistoryLocked reported no change")
	}
	samples := service.history[key].Samples
	if len(samples) != 2 || samples[0].TpsIn != 2 || samples[1].TpsIn != 3 {
		t.Fatalf("pruned samples = %#v", samples)
	}
}

func newTPSHistoryTestService(historyPath string, current *time.Time) *Service {
	return &Service{
		history:         make(map[string]*brokerTPSHistory),
		historyFilePath: historyPath,
		now:             func() time.Time { return *current },
	}
}

func onlineBroker(address string, tpsIn, tpsOut int) *model.BrokerNode {
	return &model.BrokerNode{
		Address: address,
		Status:  model.NodeOnline,
		TpsIn:   tpsIn,
		TpsOut:  tpsOut,
	}
}
