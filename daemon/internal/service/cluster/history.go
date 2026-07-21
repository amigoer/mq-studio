package cluster

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/storage/atomicfile"
)

const (
	tpsHistoryFileVersion = 1
	tpsHistoryMinutes     = 60
	secondsPerMinute      = int64(time.Minute / time.Second)
)

type brokerTPSSample struct {
	Timestamp int64 `json:"timestamp"`
	TpsIn     int   `json:"tpsIn"`
	TpsOut    int   `json:"tpsOut"`
}

type brokerTPSHistory struct {
	Samples []brokerTPSSample `json:"samples"`
}

type tpsHistoryStore struct {
	Version int                          `json:"version"`
	Brokers map[string]*brokerTPSHistory `json:"brokers"`
}

// recordBrokerTPS coalesces live values into one-minute buckets, attaches the
// retained history to each broker, and persists changes once per overview load.
func (s *Service) recordBrokerTPS(nameServers []string, brokers []*model.BrokerNode) {
	nowMinute := s.now().UTC().Truncate(time.Minute).Unix()
	scope := tpsHistoryScope(nameServers)

	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	changed := s.pruneTPSHistoryLocked(nowMinute)
	for _, broker := range brokers {
		if broker == nil || broker.Address == "" {
			continue
		}

		key := scope + "|" + broker.Address
		history, ok := s.history[key]
		if !ok || history == nil {
			if broker.Status != model.NodeOnline || broker.TpsIn < 0 || broker.TpsOut < 0 {
				copyTPSHistoryToBroker(&brokerTPSHistory{}, broker)
				continue
			}
			history = &brokerTPSHistory{Samples: make([]brokerTPSSample, 0, tpsHistoryMinutes)}
			s.history[key] = history
		}

		if broker.Status == model.NodeOnline && broker.TpsIn >= 0 && broker.TpsOut >= 0 {
			changed = upsertTPSSample(history, brokerTPSSample{
				Timestamp: nowMinute,
				TpsIn:     broker.TpsIn,
				TpsOut:    broker.TpsOut,
			}) || changed
		}
		copyTPSHistoryToBroker(history, broker)
	}

	if !changed || strings.TrimSpace(s.historyFilePath) == "" {
		return
	}
	if err := s.saveTPSHistoryLocked(); err != nil {
		log.Printf("[ClusterService] failed to save TPS history: %v", err)
	}
}

func tpsHistoryScope(nameServers []string) string {
	addresses := append([]string(nil), nameServers...)
	for index := range addresses {
		addresses[index] = strings.TrimSpace(addresses[index])
	}
	sort.Strings(addresses)
	return strings.Join(addresses, ";")
}

func upsertTPSSample(history *brokerTPSHistory, sample brokerTPSSample) bool {
	for index := len(history.Samples) - 1; index >= 0; index-- {
		current := history.Samples[index]
		if current.Timestamp != sample.Timestamp {
			continue
		}
		if current.TpsIn == sample.TpsIn && current.TpsOut == sample.TpsOut {
			return false
		}
		history.Samples[index] = sample
		return true
	}
	history.Samples = append(history.Samples, sample)
	sort.Slice(history.Samples, func(i, j int) bool {
		return history.Samples[i].Timestamp < history.Samples[j].Timestamp
	})
	return true
}

func copyTPSHistoryToBroker(history *brokerTPSHistory, broker *model.BrokerNode) {
	count := len(history.Samples)
	broker.TpsHistoryTimestamps = make([]int64, 0, count)
	broker.TpsInHistory = make([]int, 0, count)
	broker.TpsOutHistory = make([]int, 0, count)
	for _, sample := range history.Samples {
		broker.TpsHistoryTimestamps = append(broker.TpsHistoryTimestamps, sample.Timestamp)
		broker.TpsInHistory = append(broker.TpsInHistory, sample.TpsIn)
		broker.TpsOutHistory = append(broker.TpsOutHistory, sample.TpsOut)
	}
}

func (s *Service) pruneTPSHistoryLocked(nowMinute int64) bool {
	cutoff := nowMinute - int64(tpsHistoryMinutes-1)*secondsPerMinute
	changed := false
	for key, history := range s.history {
		if history == nil {
			delete(s.history, key)
			changed = true
			continue
		}
		normalized := normalizeTPSSamples(history.Samples, cutoff, nowMinute)
		if !tpsSamplesEqual(history.Samples, normalized) {
			history.Samples = normalized
			changed = true
		}
		if len(history.Samples) == 0 {
			delete(s.history, key)
			changed = true
		}
	}
	return changed
}

func normalizeTPSSamples(samples []brokerTPSSample, cutoff, nowMinute int64) []brokerTPSSample {
	byTimestamp := make(map[int64]brokerTPSSample, len(samples))
	for _, sample := range samples {
		if sample.Timestamp < cutoff || sample.Timestamp > nowMinute {
			continue
		}
		byTimestamp[sample.Timestamp] = sample
	}
	timestamps := make([]int64, 0, len(byTimestamp))
	for timestamp := range byTimestamp {
		timestamps = append(timestamps, timestamp)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i] < timestamps[j] })
	normalized := make([]brokerTPSSample, 0, len(timestamps))
	for _, timestamp := range timestamps {
		normalized = append(normalized, byTimestamp[timestamp])
	}
	return normalized
}

func tpsSamplesEqual(left, right []brokerTPSSample) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (s *Service) loadTPSHistory() error {
	if strings.TrimSpace(s.historyFilePath) == "" {
		return nil
	}
	data, err := os.ReadFile(s.historyFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	var store tpsHistoryStore
	if err := json.Unmarshal(data, &store); err != nil {
		return err
	}
	if store.Version > tpsHistoryFileVersion {
		return errors.New("TPS history file was created by a newer Rocket Leaf version")
	}
	if store.Brokers == nil {
		return nil
	}
	s.history = store.Brokers
	s.pruneTPSHistoryLocked(s.now().UTC().Truncate(time.Minute).Unix())
	return nil
}

func (s *Service) saveTPSHistoryLocked() error {
	data, err := json.MarshalIndent(tpsHistoryStore{
		Version: tpsHistoryFileVersion,
		Brokers: s.history,
	}, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(s.historyFilePath, data)
}
