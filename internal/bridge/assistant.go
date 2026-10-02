package bridge

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/amigoer/mq-studio/internal/agent/assistant"
)

// AgentEvent carries every change to a conversation. The renderer applies
// them in seq order, and asks for a snapshot when one is missing.
const AgentEvent = "agent:event"

func init() {
	// Registered so the bindings carry the event's shape.
	application.RegisterEvent[assistant.Event](AgentEvent)
}

// AgentService runs the window's assistant: its conversations, the runs that
// answer them, and the questions a run puts to the person.
type AgentService struct {
	manager *assistant.Manager
}

// NewAgentService fronts manager.
func NewAgentService(manager *assistant.Manager) *AgentService {
	return &AgentService{manager: manager}
}

// Start opens a conversation on a model service; empty is the default one.
func (s *AgentService) Start(provider string) (assistant.Summary, error) {
	return s.manager.Start(provider)
}

// Send adds what the person said, and where they were, and starts the run
// that answers it. What the run does arrives as events.
func (s *AgentService) Send(session, text string, where assistant.Context) error {
	return s.manager.Send(session, text, where)
}

// Stop ends a conversation's run.
func (s *AgentService) Stop(session string) error {
	return s.manager.Stop(session)
}

// Decide answers a question a run is waiting on.
func (s *AgentService) Decide(session, ask string, approve, remember bool) error {
	return s.manager.Decide(session, ask, approve, remember)
}

// Snapshot is a conversation as it stands, for a renderer that missed an
// event or opened late.
func (s *AgentService) Snapshot(session string) (assistant.Snapshot, error) {
	return s.manager.Snapshot(session)
}

// Sessions lists the conversations, the newest first.
func (s *AgentService) Sessions() []assistant.Summary {
	return s.manager.Sessions()
}
