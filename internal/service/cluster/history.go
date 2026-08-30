package cluster

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/atomicfile"
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
// retained history to each broker, and persists changes once per sample.
func (s *Service) recordBrokerTPS(connID int, brokers []*model.Node) {
	nowMinute := s.now().UTC().Truncate(time.Minute).Unix()

	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	changed := s.pruneTPSHistoryLocked(nowMinute)
	for _, broker := range brokers {
		if broker == nil || broker.Address == "" {
			continue
		}

		key := tpsHistoryKey(connID, broker.Address)
		history, ok := s.history[key]
		if !ok || history == nil {
			if broker.Status != model.NodeOnline || broker.RateIn < 0 || broker.RateOut < 0 {
				copyTPSHistoryToBroker(&brokerTPSHistory{}, broker)
				continue
			}
			history = &brokerTPSHistory{Samples: make([]brokerTPSSample, 0, tpsHistoryMinutes)}
			s.history[key] = history
		}

		if broker.Status == model.NodeOnline && broker.RateIn >= 0 && broker.RateOut >= 0 {
			changed = upsertTPSSample(history, brokerTPSSample{
				Timestamp: nowMinute,
				TpsIn:     broker.RateIn,
				TpsOut:    broker.RateOut,
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

// attachTPSHistory fills in what has already been recorded for each broker,
// without sampling.
//
// Reading and recording are separate on purpose. A page re-reads every thirty
// seconds, so recording here would leave each minute bucket holding whichever
// refresh landed last rather than the collector's one sample per minute - and
// a page nobody has open would stop the history accruing altogether.
func (s *Service) attachTPSHistory(connID int, brokers []*model.Node) {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	for _, broker := range brokers {
		if broker == nil || broker.Address == "" {
			continue
		}
		history := s.history[tpsHistoryKey(connID, broker.Address)]
		if history == nil {
			history = &brokerTPSHistory{}
		}
		copyTPSHistoryToBroker(history, broker)
	}
}

// tpsHistoryKey scopes one broker's history to the connection it was sampled
// through.
//
// The connection id, not the cluster's addresses: two profiles may point at
// the same host under different credentials, and a broker set changes whenever
// one is added or taken out of the write path - keying on it voided every
// broker's history the moment the cluster changed shape.
func tpsHistoryKey(connID int, address string) string {
	return strconv.Itoa(connID) + "|" + address
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

func copyTPSHistoryToBroker(history *brokerTPSHistory, broker *model.Node) {
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
		return errors.New("TPS history file was created by a newer MQ Studio version")
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
