package cluster

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// brokerTPSHistory stores a rolling TPS history for one broker.
type brokerTPSHistory struct {
	tpsIn  []int
	tpsOut []int
}

// At a 30-second polling interval, 60 samples represent about 30 minutes.
const tpsHistoryLen = 60

// recordBrokerTPS appends current TPS values and copies the history to the response model.
func (s *Service) recordBrokerTPS(broker *model.BrokerNode) {
	if broker == nil || broker.Address == "" || broker.Status != model.NodeOnline || broker.TpsIn < 0 || broker.TpsOut < 0 {
		return
	}

	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	history, ok := s.history[broker.Address]
	if !ok {
		history = &brokerTPSHistory{}
		s.history[broker.Address] = history
	}
	history.tpsIn = appendCapped(history.tpsIn, broker.TpsIn, tpsHistoryLen)
	history.tpsOut = appendCapped(history.tpsOut, broker.TpsOut, tpsHistoryLen)

	// Copy the slices so later appends cannot mutate data already returned to callers.
	broker.TpsInHistory = append([]int(nil), history.tpsIn...)
	broker.TpsOutHistory = append([]int(nil), history.tpsOut...)
}

func appendCapped(values []int, value, limit int) []int {
	values = append(values, value)
	if len(values) > limit {
		values = values[len(values)-limit:]
	}
	return values
}
