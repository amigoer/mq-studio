package assistant

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/app"
)

// Config is what a Manager is built from.
type Config struct {
	Store    *Store
	Services *app.Services
	// Translate resolves i18n keys in the application's language, for the
	// question put before a destructive write.
	Translate func(string) string
	// Journal is the audit log, which the MCP server writes too.
	Journal *audit.Journal
	// Client names the application in the audit log.
	Client string
	// Emit hands an event to the window. It is called with the manager's lock
	// held, which is what keeps the events in order, so it must neither block
	// nor call back in.
	Emit func(Event)
}

/*
 * Manager holds the window's conversations, and runs them.
 *
 * One run goes at a time in the whole window. Two would put questions to the
 * person side by side about writes neither knows the other is making, and
 * their reads would queue behind each other on the same connections anyway.
 * Conversations are kept in memory only.
 */
type Manager struct {
	store     *Store
	services  *app.Services
	translate func(string) string
	journal   *audit.Journal
	client    string
	emit      func(Event)
	newChat   func(context.Context, provider.Endpoint, provider.Options) (provider.Chat, error)
	now       func() time.Time
	limit     int
	tick      time.Duration

	mu       sync.Mutex
	sessions map[string]*session
	order    []*session
	running  *session
}

const (
	// maxCalls is how many tools one run may call before it stops to say so:
	// enough for a real diagnosis, short of a loop that never ends.
	maxCalls = 25
	// tick is how long streamed text waits to go to the window with what
	// follows it, so a fast model is not one event per word.
	tick = 40 * time.Millisecond
)

// NewManager starts with no conversations.
func NewManager(config Config) *Manager {
	journal := config.Journal
	if journal == nil {
		// A log with nowhere to go refuses every write, which is the point.
		journal = audit.Open("")
	}
	return &Manager{
		store:     config.Store,
		services:  config.Services,
		translate: config.Translate,
		journal:   journal,
		client:    config.Client,
		emit:      config.Emit,
		newChat:   provider.NewChat,
		now:       time.Now,
		limit:     maxCalls,
		tick:      tick,
		sessions:  make(map[string]*session),
	}
}

// session is one conversation.
type session struct {
	id       string
	provider string

	// Guarded by Manager.mu.
	model  string
	title  string
	seq    int64
	next   int
	items  []Item
	usage  provider.Usage
	cancel context.CancelFunc
	asks   map[string]chan decision
	// queue is what the person said since the last run took it.
	queue []string

	// Owned by the run going.
	chat     provider.Chat
	endpoint provider.Endpoint
	// answered is whether the model has taken a turn. Until it has, the
	// conversation is only what the person said, kept in said.
	answered   bool
	said       []string
	remembered map[string]bool
}

// decision is a person's answer to a question.
type decision struct {
	approve, remember bool
}

// Start opens a conversation on a model service: the one named, or the
// default when the name is empty.
func (m *Manager) Start(providerID string) (Summary, error) {
	settings, err := m.store.Settings()
	if err != nil {
		return Summary{}, err
	}
	chosen, err := choose(settings, providerID)
	if err != nil {
		return Summary{}, err
	}
	s := &session{
		id:         audit.NewSession(),
		provider:   chosen.ID,
		model:      chosen.Model,
		asks:       make(map[string]chan decision),
		remembered: make(map[string]bool),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[s.id] = s
	m.order = append(m.order, s)
	return m.summaryLocked(s), nil
}

func choose(settings Settings, id string) (Provider, error) {
	if id == "" {
		id = settings.Default
	}
	if id == "" {
		if len(settings.Providers) == 0 {
			return Provider{}, errors.New("no model service is set up yet; add one in the settings, under the assistant")
		}
		return settings.Providers[0], nil
	}
	if index := settings.index(id); index >= 0 {
		return settings.Providers[index], nil
	}
	return Provider{}, fmt.Errorf("there is no model service %q", id)
}

// Send adds what the person said to a conversation, and starts a run to
// answer it.
func (m *Manager) Send(sessionID, text string, where Context) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("there is nothing to send")
	}
	// Composed outside the lock: it reads the connection store.
	composed := m.compose(text, where)
	settings, err := m.store.Settings()
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.sessionLocked(sessionID)
	if err != nil {
		return err
	}
	if err := m.readyLocked(s, settings); err != nil {
		return err
	}
	if s.title == "" {
		s.title = titleOf(text)
	}
	m.addLocked(s, Item{Kind: ItemUser, Text: text, Context: &where})
	s.queue = append(s.queue, composed)
	m.startLocked(s)
	return nil
}

// Continue runs a conversation again from where its last run ended without
// an answer: a service that failed, a stop, or the tool limit. Nothing new is
// said; the model takes up the history as it stands.
func (m *Manager) Continue(sessionID string) error {
	settings, err := m.store.Settings()
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.sessionLocked(sessionID)
	if err != nil {
		return err
	}
	if err := m.readyLocked(s, settings); err != nil {
		return err
	}
	if n := len(s.items); n == 0 || !slices.Contains(continuable, s.items[n-1].Notice) {
		return errors.New("this conversation has nothing to carry on with; say something instead")
	}
	m.startLocked(s)
	return nil
}

// continuable are the notices a run can be carried on from. One cut off at
// its length or refused would only be asked the same thing again.
var continuable = []string{NoticeFailed, NoticeStopped, NoticeLimit}

// readyLocked refuses a run that may not start: another is going, or the
// person has not agreed to send anything to this conversation's service.
func (m *Manager) readyLocked(s *session, settings Settings) error {
	switch m.running {
	case nil:
	case s:
		return errors.New("this conversation is still answering; stop it or wait for it")
	default:
		return errors.New("another conversation is answering; stop it or wait for it")
	}
	if !slices.Contains(settings.Consented, s.provider) {
		return errors.New("nothing is sent to a model service before the person agrees to it")
	}
	return nil
}

func (m *Manager) startLocked(s *session) {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel, m.running = cancel, s
	m.emitLocked(s, Event{Kind: EventRun, Running: true, Model: s.model})
	go m.run(ctx, s)
}

// Stop ends a conversation's run. A write already under way is let finish,
// so a stop never leaves a broker half way through a change; nothing after
// it starts.
func (m *Manager) Stop(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.sessionLocked(sessionID)
	if err != nil {
		return err
	}
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

// Decide answers a question a run is waiting on. Remember lets every later
// call of the same write through for the rest of the conversation; it means
// nothing for a destruction, which is confirmed every time.
func (m *Manager) Decide(sessionID, askID string, approve, remember bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.sessionLocked(sessionID)
	if err != nil {
		return err
	}
	answer, waiting := s.asks[askID]
	if !waiting {
		return errors.New("that question is no longer waiting for an answer")
	}
	delete(s.asks, askID)
	answer <- decision{approve: approve, remember: remember}
	return nil
}

// Snapshot is a conversation as it stands.
func (m *Manager) Snapshot(sessionID string) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.sessionLocked(sessionID)
	if err != nil {
		return Snapshot{}, err
	}
	items := make([]Item, len(s.items))
	for i, item := range s.items {
		items[i] = item.clone()
	}
	return Snapshot{
		Session: s.id, Seq: s.seq, Running: m.running == s, Model: s.model, Items: items, Usage: s.usage,
	}, nil
}

// Sessions lists the conversations, the newest first.
func (m *Manager) Sessions() []Summary {
	m.mu.Lock()
	defer m.mu.Unlock()
	summaries := make([]Summary, 0, len(m.order))
	for i := len(m.order) - 1; i >= 0; i-- {
		summaries = append(summaries, m.summaryLocked(m.order[i]))
	}
	return summaries
}

func (m *Manager) summaryLocked(s *session) Summary {
	return Summary{ID: s.id, Title: s.title, Provider: s.provider, Model: s.model, Running: m.running == s}
}

func (m *Manager) sessionLocked(id string) (*session, error) {
	if s, ok := m.sessions[id]; ok {
		return s, nil
	}
	return nil, fmt.Errorf("there is no conversation %q", id)
}

// emitLocked numbers an event and hands it to the window.
func (m *Manager) emitLocked(s *session, event Event) {
	s.seq++
	event.Session, event.Seq = s.id, s.seq
	if m.emit != nil {
		m.emit(event)
	}
}

// addLocked appends an item and returns its id.
func (m *Manager) addLocked(s *session, item Item) string {
	s.next++
	item.ID = strconv.Itoa(s.next)
	s.items = append(s.items, item)
	shown := item.clone()
	m.emitLocked(s, Event{Kind: EventItem, Item: &shown})
	return item.ID
}

// add is addLocked for a run.
func (m *Manager) add(s *session, item Item) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.addLocked(s, item)
}

// changeLocked changes an item and sends it whole.
func (m *Manager) changeLocked(s *session, id string, change func(*Item)) {
	for i := len(s.items) - 1; i >= 0; i-- {
		if s.items[i].ID == id {
			change(&s.items[i])
			shown := s.items[i].clone()
			m.emitLocked(s, Event{Kind: EventItem, Item: &shown})
			return
		}
	}
}

// changeTool changes a tool item, for a run.
func (m *Manager) changeTool(s *session, id string, change func(*ToolItem)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.changeLocked(s, id, func(item *Item) { change(item.Tool) })
}
