package bridge

import (
	"fmt"
	"os"
	"strings"
	"time"

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

// Continue runs a conversation again from where a failed, stopped or limited
// run left it, without anything new said.
func (s *AgentService) Continue(session string) error {
	return s.manager.Continue(session)
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

// Sessions lists the conversations held and kept, the most recently changed
// first.
func (s *AgentService) Sessions() ([]assistant.Summary, error) {
	return s.manager.Sessions()
}

// Rename gives a conversation a title of the person's choosing.
func (s *AgentService) Rename(session, title string) error {
	return s.manager.Rename(session, title)
}

// Delete forgets a conversation, here and on disk.
func (s *AgentService) Delete(session string) error {
	return s.manager.Delete(session)
}

// Clear forgets every conversation but one answering.
func (s *AgentService) Clear() error {
	return s.manager.Clear()
}

/*
 * SaveTranscript prompts for a file and writes a conversation to it. The
 * renderer writes the Markdown, in the reader's language, and this only puts
 * it where the person chose. It returns the path, or an empty string when the
 * person cancels.
 */
func (s *AgentService) SaveTranscript(title, markdown string) (string, error) {
	name := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < ' ' {
			return '-'
		}
		return r
	}, strings.TrimSpace(title))
	if name == "" {
		name = "conversation"
	}
	target, err := application.Get().Dialog.SaveFile().
		SetMessage("Export the conversation").
		SetFilename(fmt.Sprintf("%s %s.md", name, time.Now().Format("2006-01-02"))).
		AddFilter("Markdown", "*.md").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil
	}
	if err := os.WriteFile(target, []byte(markdown), 0o600); err != nil {
		return "", fmt.Errorf("write the conversation: %w", err)
	}
	return target, nil
}
