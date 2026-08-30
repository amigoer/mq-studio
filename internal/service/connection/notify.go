package connection

import "github.com/amigoer/mq-studio/internal/model"

// OnChange registers a listener invoked after any operation that may have
// altered the profiles. It lets the native shell - the system tray - follow
// connections the renderer alone cannot show while the window is hidden.
//
// Listeners fire on attempted mutations, including ones that failed: the
// alternative is threading a "did anything change" flag through every early
// return in the package, and a listener has to diff anyway to avoid redundant
// work. They run outside every lock, so a listener may read the service back.
func (s *Service) OnChange(listener func([]*model.ConnectionProfile)) {
	if listener == nil {
		return
	}
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	s.listeners = append(s.listeners, listener)
}

// notifyChanged is deferred first by the mutating methods, so it runs after
// their own deferred unlocks.
func (s *Service) notifyChanged() {
	s.listenersMu.RLock()
	listeners := s.listeners
	s.listenersMu.RUnlock()
	if len(listeners) == 0 {
		return
	}
	profiles := s.GetConnections()
	for _, listener := range listeners {
		listener(profiles)
	}
}
