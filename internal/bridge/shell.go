package bridge

import "sync"

// ShellPage is one destination in the active tab's sidebar.
type ShellPage struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// ShellService receives what the renderer is currently showing.
//
// The tray menu is the only consumer, and it needs this because a page label
// only exists in the renderer's i18n bundles: reporting the pages already
// translated is what keeps six protocols' navigation out of the Go process.
type ShellService struct {
	mu       sync.Mutex
	listener func(active string, page string, pages []ShellPage)
}

// NewShellService creates the service the renderer reports its view to, and
// the function that registers its single consumer.
//
// The registrar is returned rather than exposed as a method because every
// exported method here becomes a renderer binding, and registration is Go-side
// wiring: the consumer is the tray, which is built after the services are.
func NewShellService() (*ShellService, func(func(active string, page string, pages []ShellPage))) {
	service := &ShellService{}
	return service, service.onReport
}

func (s *ShellService) onReport(listener func(active string, page string, pages []ShellPage)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listener = listener
}

// ReportSession records the tab in front, the page it shows, and the pages
// that tab's protocol offers, in sidebar order. An empty active tab means the
// shell is showing something that sits beside the tabs.
func (s *ShellService) ReportSession(active string, page string, pages []ShellPage) {
	s.mu.Lock()
	listener := s.listener
	s.mu.Unlock()
	if listener == nil {
		return
	}
	listener(active, page, pages)
}
