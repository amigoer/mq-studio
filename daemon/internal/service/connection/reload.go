package connection

import (
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type reloadPlan struct {
	shouldReconnect bool
}

// reloadPlanLocked captures whether runtime connectivity must be restored.
// The caller must hold s.mu for writing.
func (s *Service) reloadPlanLocked() reloadPlan {
	plan := reloadPlan{shouldReconnect: s.reconnectReload}
	for _, connection := range s.connections {
		if connection != nil && connection.Status == model.StatusOnline {
			plan.shouldReconnect = true
			break
		}
	}
	return plan
}

// finalizeReloadPlanLocked records the reconnect requirement after in-memory
// state has been replaced. The caller must hold s.mu for writing.
func (s *Service) finalizeReloadPlanLocked(plan reloadPlan) reloadPlan {
	s.reconnectReload = plan.shouldReconnect
	return plan
}

// restoreRuntimeLocked applies client-manager effects after the persisted and
// in-memory state transaction has released s.mu. The caller must hold runtimeMu.
func (s *Service) restoreRuntimeLocked(plan reloadPlan) error {
	s.runtime.CloseAll()
	if plan.shouldReconnect {
		s.mu.RLock()
		defaultID := 0
		for _, connection := range s.connections {
			if connection != nil && connection.IsDefault {
				defaultID = connection.ID
				break
			}
		}
		s.mu.RUnlock()
		if defaultID != 0 {
			if err := s.connectRuntimeLocked(defaultID); err != nil {
				return err
			}
		}
	}
	s.mu.Lock()
	s.reconnectReload = false
	s.mu.Unlock()
	return nil
}

// Reload replaces in-memory profiles from disk and restores an active default connection when needed.
func (s *Service) Reload() error {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	plan := s.reloadPlanLocked()
	if err := s.loadConnectionsFromFile(); err != nil {
		s.mu.Unlock()
		return err
	}
	plan = s.finalizeReloadPlanLocked(plan)
	s.mu.Unlock()

	return s.restoreRuntimeLocked(plan)
}
