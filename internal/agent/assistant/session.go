package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
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
	// Archive keeps conversations on disk. Nil keeps none.
	Archive *Archive
}

/*
 * Manager holds the window's conversations, and runs them.
 *
 * One run goes at a time in the whole window. Two would put questions to the
 * person side by side about writes neither knows the other is making, and
 * their reads would queue behind each other on the same connections anyway.
 *
 * A conversation is written to the archive each time a run ends, as far as
 * the retention the person chose keeps any, and read back the first time it
 * is asked for after the window opens.
 */
type Manager struct {
	store     *Store
	services  *app.Services
	translate func(string) string
	journal   *audit.Journal
	client    string
	emit      func(Event)
	archive   *Archive
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
		archive:   config.Archive,
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
	queue   []string
	created time.Time
	updated time.Time
	// connection is the one the first question was about.
	connection *audit.Connection
	// history is the conversation in the service's own shape as the last run
	// left it, which a conversation read back from disk is built again from.
	history json.RawMessage

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
	now := m.now()
	s := &session{
		id:         audit.NewSession(),
		provider:   chosen.ID,
		model:      chosen.Model,
		created:    now,
		updated:    now,
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
	var about *audit.Connection
	if where.Connection != 0 {
		connection := m.auditConnection(where.Connection)
		about = &connection
	}
	settings, err := m.store.Settings()
	if err != nil {
		return err
	}
	s, err := m.open(sessionID)
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.heldLocked(s); err != nil {
		return err
	}
	if err := m.readyLocked(s, settings); err != nil {
		return err
	}
	if s.title == "" {
		s.title = titleOf(text)
	}
	if s.connection == nil {
		s.connection = about
	}
	s.updated = m.now()
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
	s, err := m.open(sessionID)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.heldLocked(s); err != nil {
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

// Snapshot is a conversation as it stands, read back from disk if need be.
func (m *Manager) Snapshot(sessionID string) (Snapshot, error) {
	s, err := m.open(sessionID)
	if err != nil {
		return Snapshot{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.heldLocked(s); err != nil {
		return Snapshot{}, err
	}
	items := make([]Item, len(s.items))
	for i, item := range s.items {
		items[i] = item.clone()
	}
	return Snapshot{
		Session: s.id, Seq: s.seq, Title: s.title, Running: m.running == s, Model: s.model,
		Items: items, Usage: s.usage,
	}, nil
}

// Sessions lists the conversations this window holds and the ones kept on
// disk, the most recently changed first.
func (m *Manager) Sessions() ([]Summary, error) {
	if err := m.Prune(); err != nil {
		log.Printf("[agent] could not clear out old conversations: %v", err)
	}
	var kept []Summary
	if m.archive != nil {
		listed, err := m.archive.List()
		if err != nil {
			return nil, err
		}
		kept = listed
	}

	m.mu.Lock()
	summaries := make([]Summary, 0, len(m.order)+len(kept))
	held := make(map[string]bool, len(m.order))
	for _, s := range m.order {
		// One nobody has said anything in is not a conversation yet.
		if len(s.items) == 0 {
			continue
		}
		held[s.id] = true
		summaries = append(summaries, m.summaryLocked(s))
	}
	m.mu.Unlock()
	for _, summary := range kept {
		if !held[summary.ID] {
			summaries = append(summaries, summary)
		}
	}
	slices.SortFunc(summaries, func(left, right Summary) int {
		if order := right.Updated.Compare(left.Updated); order != 0 {
			return order
		}
		return strings.Compare(left.ID, right.ID)
	})
	return summaries, nil
}

func (m *Manager) summaryLocked(s *session) Summary {
	return Summary{
		ID: s.id, Title: s.title, Provider: s.provider, Model: s.model, Connection: s.connection,
		Created: s.created, Updated: s.updated, Running: m.running == s, Open: true,
	}
}

// Rename gives a conversation the title a person chose.
func (m *Manager) Rename(sessionID, title string) error {
	title = strings.Join(strings.Fields(title), " ")
	if title == "" {
		return errors.New("a conversation needs a title")
	}
	if runes := []rune(title); len(runes) > maxTitle {
		title = string(runes[:maxTitle])
	}
	s, err := m.open(sessionID)
	if err != nil {
		return err
	}
	m.mu.Lock()
	if err := m.heldLocked(s); err != nil {
		m.mu.Unlock()
		return err
	}
	s.title = title
	m.emitLocked(s, Event{Kind: EventTitle, Text: title})
	// A run going writes the conversation when it ends, title and all.
	keep := m.running != s && len(s.items) > 0
	kept := m.recordLocked(s)
	m.mu.Unlock()
	if keep {
		m.keep(kept)
	}
	return nil
}

// maxTitle bounds a title a person types, to what a list can show.
const maxTitle = 80

// Delete forgets a conversation, here and on disk. One that is answering
// has to be stopped first.
func (m *Manager) Delete(sessionID string) error {
	m.mu.Lock()
	if s, held := m.sessions[sessionID]; held {
		if m.running == s {
			m.mu.Unlock()
			return errors.New("this conversation is still answering; stop it first")
		}
		m.forgetLocked(s)
	}
	m.mu.Unlock()
	if m.archive == nil {
		return nil
	}
	return m.archive.Delete(sessionID)
}

// Clear forgets every conversation, here and on disk, but the one answering.
func (m *Manager) Clear() error {
	m.mu.Lock()
	running := m.running
	for _, s := range slices.Clone(m.order) {
		if s != running {
			m.forgetLocked(s)
		}
	}
	m.mu.Unlock()
	if m.archive == nil {
		return nil
	}
	return m.archive.Prune(forever, func(id string) bool { return running != nil && running.id == id })
}

// forever is a cutoff no conversation was changed after.
var forever = time.Unix(1<<40, 0)

func (m *Manager) forgetLocked(s *session) {
	m.emitLocked(s, Event{Kind: EventGone})
	delete(m.sessions, s.id)
	m.order = slices.DeleteFunc(m.order, func(one *session) bool { return one == s })
}

// Prune deletes the conversations kept on disk past the retention the
// person chose, all of them when it keeps none.
func (m *Manager) Prune() error {
	if m.archive == nil {
		return nil
	}
	settings, err := m.store.Settings()
	if err != nil {
		return err
	}
	cutoff := m.now().AddDate(0, 0, -settings.Retention)
	if settings.Retention == 0 {
		cutoff = forever
	}
	m.mu.Lock()
	running := m.running
	m.mu.Unlock()
	return m.archive.Prune(cutoff, func(id string) bool { return running != nil && running.id == id })
}

// keep writes a conversation to disk, as far as the settings keep any.
func (m *Manager) keep(kept record) {
	if m.archive == nil {
		return
	}
	settings, err := m.store.Settings()
	if err != nil || settings.Retention == 0 {
		return
	}
	if err := m.archive.Save(kept); err != nil {
		log.Printf("[agent] could not keep conversation %s: %v", kept.ID, err)
	}
}

// recordLocked is a conversation as the archive writes it. Answered and said
// are the run's own, read here only once it has ended or before one starts.
func (m *Manager) recordLocked(s *session) record {
	items := make([]Item, len(s.items))
	for i, item := range s.items {
		items[i] = item.clone()
	}
	return record{
		ID: s.id, Title: s.title, Provider: s.provider, Model: s.model, Connection: s.connection,
		Created: s.created, Updated: s.updated, Items: items, Usage: s.usage,
		Answered: s.answered, Said: slices.Clone(s.said), History: s.history, Seq: s.seq,
	}
}

// open is a conversation, read back from disk if this window has not held
// it yet.
func (m *Manager) open(id string) (*session, error) {
	m.mu.Lock()
	s, held := m.sessions[id]
	m.mu.Unlock()
	if held {
		return s, nil
	}
	if m.archive == nil {
		return nil, fmt.Errorf("there is no conversation %q", id)
	}
	kept, err := m.archive.Load(id)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("there is no conversation %q", id)
	}
	if err != nil {
		return nil, err
	}
	restored := fromRecord(kept)
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, held := m.sessions[id]; held {
		return s, nil
	}
	m.sessions[id] = restored
	m.order = append(m.order, restored)
	return restored, nil
}

func fromRecord(kept record) *session {
	next := 0
	for _, item := range kept.Items {
		if n, err := strconv.Atoi(item.ID); err == nil && n > next {
			next = n
		}
	}
	return &session{
		id: kept.ID, provider: kept.Provider, model: kept.Model, title: kept.Title,
		seq: kept.Seq, next: next, items: kept.Items, usage: kept.Usage,
		created: kept.Created, updated: kept.Updated, connection: kept.Connection, history: kept.History,
		answered: kept.Answered, said: kept.Said,
		asks: make(map[string]chan decision), remembered: make(map[string]bool),
	}
}

// heldLocked refuses a conversation deleted since it was opened.
func (m *Manager) heldLocked(s *session) error {
	if m.sessions[s.id] != s {
		return fmt.Errorf("there is no conversation %q", s.id)
	}
	return nil
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
