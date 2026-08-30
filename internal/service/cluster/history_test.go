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
	service.recordBrokerTPS(7, []*model.Node{broker})
	broker.RateIn = 12
	broker.RateOut = 5
	service.recordBrokerTPS(7, []*model.Node{broker})

	if len(broker.TpsInHistory) != 1 || broker.TpsInHistory[0] != 12 {
		t.Fatalf("same-minute history = %#v, want [12]", broker.TpsInHistory)
	}

	current = current.Add(time.Minute)
	broker.RateIn = 20
	broker.RateOut = 8
	service.recordBrokerTPS(7, []*model.Node{broker})

	restored := newTPSHistoryTestService(historyPath, &current)
	if err := restored.loadTPSHistory(); err != nil {
		t.Fatal(err)
	}
	offline := &model.Node{Address: broker.Address, Status: model.NodeOffline, RateIn: -1, RateOut: -1}
	restored.recordBrokerTPS(7, []*model.Node{offline})

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
	key := tpsHistoryKey(7, "127.0.0.1:10911")
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

// The overview reads history it did not record: the collector samples on its
// own timer, and the page that draws the trend chart only reads back. Nothing
// attached what had been recorded, so the chart sat on its empty state no
// matter how long the collector had been running.
func TestAttachTPSHistoryFillsBrokersWithoutSampling(t *testing.T) {
	current := time.Now().UTC().Truncate(time.Minute)
	service := newTPSHistoryTestService("", &current)
	service.recordBrokerTPS(7, []*model.Node{onlineBroker("127.0.0.1:10911", 10, 4)})

	read := &model.Node{Address: "127.0.0.1:10911", Status: model.NodeOnline, RateIn: 99, RateOut: 99}
	service.attachTPSHistory(7, []*model.Node{read})

	if len(read.TpsInHistory) != 1 || read.TpsInHistory[0] != 10 {
		t.Fatalf("attached inbound history = %#v, want [10]", read.TpsInHistory)
	}
	if read.TpsOutHistory[0] != 4 {
		t.Fatalf("attached outbound history = %#v, want [4]", read.TpsOutHistory)
	}
	samples := service.history[tpsHistoryKey(7, read.Address)].Samples
	if len(samples) != 1 || samples[0].TpsIn != 10 {
		t.Fatalf("reading recorded a sample: %#v", samples)
	}

	other := &model.Node{Address: "127.0.0.1:10911", Status: model.NodeOnline}
	service.attachTPSHistory(8, []*model.Node{other})
	if len(other.TpsInHistory) != 0 {
		t.Fatalf("another connection saw history = %#v", other.TpsInHistory)
	}
}

// The scope used to be the broker addresses, so a cluster that gained or lost
// a broker changed every key at once and started the whole history over.
func TestTPSHistorySurvivesBrokerSetChanges(t *testing.T) {
	current := time.Now().UTC().Truncate(time.Minute)
	service := newTPSHistoryTestService("", &current)
	first := onlineBroker("127.0.0.1:10911", 10, 4)
	service.recordBrokerTPS(7, []*model.Node{first})

	current = current.Add(time.Minute)
	first.RateIn = 20
	service.recordBrokerTPS(7, []*model.Node{first, onlineBroker("127.0.0.1:10921", 1, 1)})

	if len(first.TpsInHistory) != 2 || first.TpsInHistory[0] != 10 {
		t.Fatalf("history after the cluster grew = %#v, want [10 20]", first.TpsInHistory)
	}
}

func newTPSHistoryTestService(historyPath string, current *time.Time) *Service {
	return &Service{
		history:         make(map[string]*brokerTPSHistory),
		historyFilePath: historyPath,
		now:             func() time.Time { return *current },
	}
}

func onlineBroker(address string, tpsIn, tpsOut int) *model.Node {
	return &model.Node{
		Address: address,
		Status:  model.NodeOnline,
		RateIn:  tpsIn,
		RateOut: tpsOut,
	}
}
