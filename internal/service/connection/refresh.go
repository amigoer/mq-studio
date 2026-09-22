package connection

import "bytes"

/*
 * RefreshReadOnly brings a process that may not write the profile store level
 * with it: the window rewrites the file whole, and a second process that read
 * it once at startup never saw a connection added, deleted or re-keyed since.
 *
 * Clients OpenReadOnly opened are dropped when their profile is gone or would
 * now be dialled differently, judged by dialParametersChanged against what was
 * actually dialled - so a status stamp, which the window writes on every
 * connect, drops nothing, and a settings change such as the global credentials
 * (refreshed by the caller first) does. Nothing is written.
 *
 * Never call it from the window, whose profiles in memory are the authority.
 */
func (s *Service) RefreshReadOnly() error {
	data, err := readStore(s.dataFilePath)
	if err != nil {
		return err
	}
	// The only path that skips runtimeMu, which a dial holds for as long as
	// the broker takes to answer.
	if s.unchanged(data) {
		return nil
	}

	defer s.notifyChanged()
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	// A refresh that queued behind this lock may hold an older copy than the
	// one just applied.
	data, err = readStore(s.dataFilePath)
	if err != nil {
		return err
	}

	s.mu.Lock()
	if !bytes.Equal(data, s.lastRead) {
		if data == nil {
			s.connections, s.nextID = buildConnectionState(nil)
			s.lastRead = nil
		} else if err := s.loadConnections(data); err != nil {
			s.mu.Unlock()
			return err
		}
	}
	stale := s.staleDialsLocked()
	for _, id := range stale {
		delete(s.dialed, id)
	}
	s.mu.Unlock()

	for _, id := range stale {
		s.runtime.Remove(id)
	}
	return nil
}

// unchanged reports whether the store reads as it did and every client this
// process opened would still be dialled the same way.
func (s *Service) unchanged(data []byte) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return bytes.Equal(data, s.lastRead) && len(s.staleDialsLocked()) == 0
}

// staleDialsLocked lists the clients OpenReadOnly opened that the profiles no
// longer describe. The caller must hold mu.
func (s *Service) staleDialsLocked() []int {
	var stale []int
	for id, dialed := range s.dialed {
		connection, exists := s.connections[id]
		if !exists || dialParametersChanged(dialed, s.resolveForDial(connection)) {
			stale = append(stale, id)
		}
	}
	return stale
}
