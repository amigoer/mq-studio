package assistant

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// turn is one scripted model turn.
type turn func(ctx context.Context, delta func(provider.Delta)) (provider.Turn, error)

// fakeModel stands in for a model service. The chats it builds play its
// turns in order, and everything any of them is told is kept.
type fakeModel struct {
	mu    sync.Mutex
	turns []turn
	next  int
	built []provider.Options
	chats []*fakeChat
}

func (f *fakeModel) newChat(_ context.Context, _ provider.Endpoint, options provider.Options) (provider.Chat, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	chat := &fakeChat{model: f}
	f.built, f.chats = append(f.built, options), append(f.chats, chat)
	return chat, nil
}

// chat is the nth chat built, as it stands.
func (f *fakeModel) chat(t *testing.T, n int) fakeChat {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if n >= len(f.chats) {
		t.Fatalf("chat %d was never built; %d were", n, len(f.chats))
	}
	return *f.chats[n]
}

type fakeChat struct {
	model   *fakeModel
	said    []string
	results [][]provider.Result
	offered [][]provider.Tool
	reached []provider.Endpoint
}

func (c *fakeChat) User(text string) {
	c.model.mu.Lock()
	defer c.model.mu.Unlock()
	c.said = append(c.said, text)
}

func (c *fakeChat) Results(results []provider.Result) {
	c.model.mu.Lock()
	defer c.model.mu.Unlock()
	c.results = append(c.results, results)
}

func (c *fakeChat) Offer(tools []provider.Tool) {
	c.model.mu.Lock()
	defer c.model.mu.Unlock()
	c.offered = append(c.offered, tools)
}

// History is what the chat was told, which is all a fake has to give back.
func (c *fakeChat) History() (json.RawMessage, error) {
	c.model.mu.Lock()
	defer c.model.mu.Unlock()
	return json.Marshal(c.said)
}

func (c *fakeChat) Reach(endpoint provider.Endpoint) error {
	c.model.mu.Lock()
	defer c.model.mu.Unlock()
	c.reached = append(c.reached, endpoint)
	return nil
}

func (c *fakeChat) Next(ctx context.Context, delta func(provider.Delta)) (provider.Turn, error) {
	c.model.mu.Lock()
	if c.model.next >= len(c.model.turns) {
		c.model.mu.Unlock()
		return provider.Turn{}, errors.New("the script has no more turns")
	}
	next := c.model.turns[c.model.next]
	c.model.next++
	c.model.mu.Unlock()
	return next(ctx, delta)
}

// says is a turn that answers in words.
func says(text string) turn {
	return func(_ context.Context, delta func(provider.Delta)) (provider.Turn, error) {
		delta(provider.Delta{Text: text})
		return provider.Turn{Text: text, Stop: provider.StopDone, Usage: provider.Usage{Input: 100, Output: 10}}, nil
	}
}

// asks is a turn that calls tools, given as name and input pairs.
func asks(pairs ...string) turn {
	var calls []provider.Call
	for i := 0; i+1 < len(pairs); i += 2 {
		calls = append(calls, provider.Call{
			ID: fmt.Sprintf("call-%s-%d", pairs[i], i/2), Name: pairs[i], Input: json.RawMessage(pairs[i+1]),
		})
	}
	return func(context.Context, func(provider.Delta)) (provider.Turn, error) {
		return provider.Turn{Calls: calls, Stop: provider.StopTools, Usage: provider.Usage{Input: 50, Output: 5}}, nil
	}
}

// brokerConn is one RabbitMQ connection that records what it is asked to do.
type brokerConn struct {
	capabilities model.Capabilities
	depth        int64

	mu      sync.Mutex
	created []string
	removed []string
	purged  []string
}

func (c *brokerConn) Kind() model.MQKind               { return model.KindRabbitMQ }
func (c *brokerConn) Ping(context.Context) error       { return nil }
func (c *brokerConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *brokerConn) Close() error                     { return nil }

func (c *brokerConn) ListDestinations(context.Context, model.DestinationFilter) ([]*model.Destination, error) {
	return []*model.Destination{{Ref: model.DestinationRef{Name: "orders"}}}, nil
}

func (c *brokerConn) DestinationDetail(_ context.Context, ref model.DestinationRef) (*model.Destination, error) {
	return &model.Destination{Ref: ref, Depth: c.depth}, nil
}

func (c *brokerConn) CreateDestination(_ context.Context, spec model.DestinationSpec) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.created = append(c.created, spec.Ref.Name)
	return nil
}

func (c *brokerConn) UpdateDestination(context.Context, model.DestinationSpec) error { return nil }

func (c *brokerConn) RemoveDestination(_ context.Context, ref model.DestinationRef) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removed = append(c.removed, ref.Name)
	return nil
}

func (c *brokerConn) PurgeQueue(_ context.Context, ref model.DestinationRef) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.purged = append(c.purged, ref.Name)
	return nil
}

func (c *brokerConn) MoveMessages(context.Context, model.MoveRequest) (int, error) { return 0, nil }

func (c *brokerConn) DropMessages(context.Context, model.DestinationRef, int) (int, error) {
	return 0, nil
}

func (c *brokerConn) RebalanceQueues(context.Context) error { return nil }

// done is what the connection was asked to do: created, removed and purged.
func (c *brokerConn) done() ([]string, []string, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.created), slices.Clone(c.removed), slices.Clone(c.purged)
}

type requestTimeout struct{}

func (requestTimeout) GetRequestTimeout() time.Duration { return time.Second }

// testPhrases resolves the questions from the real English file, so they read
// here as a person reads them, and a caveat key the tests made up.
func testPhrases(key string) string {
	if key == "mq.test.caveat.visible" {
		return "every consumer sees it at once"
	}
	var node any = englishLocale()
	for segment := range strings.SplitSeq(key, ".") {
		object, _ := node.(map[string]any)
		node = object[segment]
	}
	if text, ok := node.(string); ok {
		return text
	}
	return key
}

var englishLocale = sync.OnceValue(func() map[string]any {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "src", "i18n", "locales", "en.json"))
	if err != nil {
		panic(err)
	}
	var table map[string]any
	if err := json.Unmarshal(data, &table); err != nil {
		panic(err)
	}
	return table
})

// world is a manager over one stored RabbitMQ connection, scratch, open in
// the window, and one model service.
type world struct {
	t        *testing.T
	manager  *Manager
	model    *fakeModel
	store    *Store
	services *app.Services
	conn     *brokerConn
	id       int
	provider string
	paths    layout.Layout
	events   chan Event
	seen     []Event
}

func newWorld(t *testing.T) *world {
	t.Helper()
	directory := t.TempDir()
	services, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(services.Close)
	saved, err := services.Connections.AddConnection(rabbitProfile("http://scratch.invalid:15672"))
	if err != nil {
		t.Fatal(err)
	}
	conn := &brokerConn{
		capabilities: model.NewCapabilities(model.CapDestinationList, model.CapDestinationCreate,
			model.CapDestinationDelete, model.CapDestinationPurge).
			WithCaveat(model.CapDestinationCreate, "mq.test.caveat.visible"),
		depth: 1204,
	}
	conns := func(int) (driver.Conn, error) { return conn, nil }
	services.Conns = conns
	services.Topics = destination.New(conns, requestTimeout{})

	store := NewStore(filepath.Join(directory, "agent.json"))
	chosen, err := store.SaveProvider(Provider{Name: "local", Kind: provider.OpenAI, Model: "qwen3"}, KeyPreserve)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Consent(chosen.ID); err != nil {
		t.Fatal(err)
	}

	w := &world{
		t: t, model: &fakeModel{}, store: store, services: services, conn: conn, id: saved.ID,
		provider: chosen.ID, paths: layout.In(directory), events: make(chan Event, 4096),
	}
	w.manager = NewManager(Config{
		Store: store, Services: services, Translate: testPhrases,
		Journal: audit.Open(w.paths.AgentAuditFile), Client: "MQ Studio test",
		Emit: func(event Event) { w.events <- event },
	})
	w.manager.newChat = w.model.newChat
	w.manager.now = func() time.Time { return time.Date(2026, 10, 1, 14, 3, 0, 0, time.FixedZone("CST", 8*3600)) }
	return w
}

func rabbitProfile(endpoints string) model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Name: "scratch", Kind: model.KindRabbitMQ, Endpoints: endpoints, TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret("username", "guest")
	profile.SetSecret("password", "guest")
	return profile
}

// plays scripts the model's turns, with %d in an input standing for the
// scratch connection's id.
func (w *world) plays(turns ...turn) {
	w.model.mu.Lock()
	defer w.model.mu.Unlock()
	w.model.turns = append(w.model.turns, turns...)
}

func (w *world) on(format string) string {
	return fmt.Sprintf(format, w.id)
}

// send opens a conversation and says text in it.
func (w *world) send(text string, where Context) string {
	w.t.Helper()
	summary, err := w.manager.Start("")
	if err != nil {
		w.t.Fatal(err)
	}
	if err := w.manager.Send(summary.ID, text, where); err != nil {
		w.t.Fatal(err)
	}
	return summary.ID
}

// until reads events until one matches.
func (w *world) until(match func(Event) bool) Event {
	w.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case event := <-w.events:
			w.seen = append(w.seen, event)
			if match(event) {
				return event
			}
		case <-timeout:
			w.t.Fatalf("nothing matched in 5s, after %d events", len(w.seen))
		}
	}
}

// question waits for the run to ask the person something.
func (w *world) question() Item {
	w.t.Helper()
	return *w.until(func(event Event) bool {
		return event.Kind == EventItem && event.Item.Tool != nil && event.Item.Tool.State == ToolWaiting
	}).Item
}

// ended waits for the run to end.
func (w *world) ended() Event {
	w.t.Helper()
	return w.until(func(event Event) bool { return event.Kind == EventRun && !event.Running })
}

func (w *world) decide(session string, asked Item, approve, remember bool) {
	w.t.Helper()
	if err := w.manager.Decide(session, asked.Tool.Ask.ID, approve, remember); err != nil {
		w.t.Fatal(err)
	}
}

func (w *world) sessions() []Summary {
	w.t.Helper()
	summaries, err := w.manager.Sessions()
	if err != nil {
		w.t.Fatal(err)
	}
	return summaries
}

func (w *world) snapshot(session string) Snapshot {
	w.t.Helper()
	snapshot, err := w.manager.Snapshot(session)
	if err != nil {
		w.t.Fatal(err)
	}
	return snapshot
}

// tools is every tool item in a conversation.
func (w *world) tools(session string) []ToolItem {
	w.t.Helper()
	var tools []ToolItem
	for _, item := range w.snapshot(session).Items {
		if item.Tool != nil {
			tools = append(tools, *item.Tool)
		}
	}
	return tools
}

// last is a conversation's last item.
func (w *world) last(session string) Item {
	w.t.Helper()
	items := w.snapshot(session).Items
	return items[len(items)-1]
}

func (w *world) audited() []audit.Record {
	w.t.Helper()
	file, err := os.Open(w.paths.AgentAuditFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		w.t.Fatal(err)
	}
	defer file.Close()
	var records []audit.Record
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record audit.Record
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			w.t.Fatalf("a line of the audit log does not decode: %v", err)
		}
		records = append(records, record)
	}
	return records
}

func phases(records []audit.Record) []string {
	var phases []string
	for _, record := range records {
		phases = append(phases, record.Phase)
	}
	return phases
}

func TestAReadIsRunAndItsAnswerHandedBack(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_detail", w.on(`{"connection": %d, "name": "orders"}`)), says("It holds 1204."))
	session := w.send("How deep is orders?", Context{})
	w.ended()

	results := w.model.chat(t, 0).results
	if len(results) != 1 || len(results[0]) != 1 || results[0][0].IsError ||
		!strings.Contains(results[0][0].Content, "1204") {
		t.Fatalf("handed the model %+v", results)
	}
	tools := w.tools(session)
	if len(tools) != 1 || tools[0].State != ToolDone || tools[0].Title != "Read a destination" ||
		!strings.Contains(string(tools[0].Output), "1204") {
		t.Errorf("the card reads %+v", tools)
	}
	if last := w.last(session); last.Kind != ItemText || last.Text != "It holds 1204." {
		t.Errorf("the conversation ends with %+v", last)
	}
	if records := w.audited(); len(records) != 0 {
		t.Errorf("a read was audited: %+v", records)
	}
}

/*
 * A write waits for the person, and what they are shown is the write, the
 * connection it reaches and what that connection says it leaves behind. The
 * log keeps how it was let through.
 */
func TestAWriteWaitsForThePersonsApproval(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_create", w.on(`{"connection": %d, "name": "audit-trail"}`)), says("Created."))
	session := w.send("Make an audit-trail queue", Context{})

	asked := w.question()
	if asked.Tool.Ask.Kind != AskApprove || asked.Tool.Ask.Caveat != "every consumer sees it at once" ||
		asked.Tool.Connection == nil || asked.Tool.Connection.Name != "scratch" {
		t.Fatalf("the person was asked %+v", asked.Tool)
	}
	if created, _, _ := w.conn.done(); len(created) != 0 {
		t.Fatalf("created %v before anybody approved", created)
	}
	w.decide(session, asked, true, false)
	w.ended()

	if created, _, _ := w.conn.done(); !slices.Equal(created, []string{"audit-trail"}) {
		t.Fatalf("created %v", created)
	}
	tool := w.tools(session)[0]
	if tool.State != ToolDone || tool.Approved != ApprovedOnce || !strings.Contains(tool.Result, "created audit-trail") {
		t.Errorf("the card reads %+v", tool)
	}
	records := w.audited()
	if !slices.Equal(phases(records), []string{audit.PhaseStarted, audit.PhaseDone}) ||
		records[0].Call != records[1].Call || records[0].Approved != ApprovedOnce ||
		records[0].Session != session || records[0].Client != "MQ Studio test" ||
		records[0].Connection.Name != "scratch" || records[0].Allow != string(catalog.BlastDestructive) {
		t.Errorf("the log reads %+v", records)
	}
}

// A no is the model's answer too, in words that keep it from asking again.
func TestADeclinedWriteIsNotMade(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_create", w.on(`{"connection": %d, "name": "audit-trail"}`)), says("Understood."))
	session := w.send("Make an audit-trail queue", Context{})
	w.decide(session, w.question(), false, false)
	w.ended()

	if created, _, _ := w.conn.done(); len(created) != 0 {
		t.Fatalf("created %v after the person said no", created)
	}
	result := w.model.chat(t, 0).results[0][0]
	if !result.IsError || !strings.Contains(result.Content, "should not be tried again") {
		t.Errorf("the model was told %+v", result)
	}
	if tool := w.tools(session)[0]; tool.State != ToolDeclined {
		t.Errorf("the card reads %+v", tool)
	}
	if records := w.audited(); !slices.Equal(phases(records), []string{audit.PhaseRefused}) ||
		!strings.Contains(records[0].Error, "declined") {
		t.Errorf("the log reads %+v", records)
	}
}

func TestAWriteApprovedForTheConversationIsNotAskedAgain(t *testing.T) {
	w := newWorld(t)
	w.plays(
		asks("destination_create", w.on(`{"connection": %d, "name": "a"}`)),
		asks("destination_create", w.on(`{"connection": %d, "name": "b"}`)),
		says("Both made."),
	)
	session := w.send("Make a and b", Context{})
	w.decide(session, w.question(), true, true)
	w.ended()

	if created, _, _ := w.conn.done(); !slices.Equal(created, []string{"a", "b"}) {
		t.Fatalf("created %v", created)
	}
	waits := 0
	for _, event := range w.seen {
		if event.Kind == EventItem && event.Item.Tool != nil && event.Item.Tool.State == ToolWaiting {
			waits++
		}
	}
	if waits != 1 {
		t.Errorf("the person was asked %d times", waits)
	}
	records := w.audited()
	if len(records) != 4 || records[0].Approved != ApprovedSession || records[2].Approved != ApprovedSession {
		t.Errorf("the log reads %+v", records)
	}
}

/*
 * A destruction is confirmed every time, with the question the MCP server
 * asks - the target, where it is and what it holds - and the log keeps it
 * word for word. Remembering is not on offer for it.
 */
func TestADestructionIsConfirmedEveryTime(t *testing.T) {
	w := newWorld(t)
	w.plays(
		asks("destination_purge", w.on(`{"connection": %d, "name": "orders"}`)),
		asks("destination_purge", w.on(`{"connection": %d, "name": "orders"}`)),
		says("Emptied twice."),
	)
	session := w.send("Empty orders, then again", Context{})

	first := w.question()
	for _, want := range []string{"Empty orders on scratch (rabbitmq)?", "Messages it holds now: 1204."} {
		if first.Tool.Ask.Kind != AskConfirm || !strings.Contains(first.Tool.Ask.Question, want) {
			t.Fatalf("the question does not say %q: %+v", want, first.Tool.Ask)
		}
	}
	w.decide(session, first, true, true)
	w.decide(session, w.question(), true, false)
	w.ended()

	if _, _, purged := w.conn.done(); len(purged) != 2 {
		t.Fatalf("purged %v", purged)
	}
	records := w.audited()
	want := []string{audit.PhaseAsked, audit.PhaseStarted, audit.PhaseDone, audit.PhaseAsked, audit.PhaseStarted, audit.PhaseDone}
	if !slices.Equal(phases(records), want) || records[0].Question != first.Tool.Ask.Question ||
		!records[1].Confirmed || records[1].Approved != "" {
		t.Errorf("the log reads %+v", records)
	}
	if tool := w.tools(session)[0]; tool.Approved != ApprovedConfirmed {
		t.Errorf("the card reads %+v", tool)
	}
}

// What the person agreed to is the broker they were shown.
func TestAConnectionRepointedWhileThePersonReadsIsNotTouched(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_delete", w.on(`{"connection": %d, "name": "orders"}`)), says("It was not deleted."))
	session := w.send("Delete orders", Context{})
	asked := w.question()
	if _, err := w.services.Connections.UpdateConnection(w.id, rabbitProfile("http://production.invalid:15672")); err != nil {
		t.Fatal(err)
	}
	w.decide(session, asked, true, false)
	w.ended()

	if _, removed, _ := w.conn.done(); len(removed) != 0 {
		t.Fatalf("removed %v", removed)
	}
	if records := w.audited(); !slices.Equal(phases(records), []string{audit.PhaseAsked, audit.PhaseRefused}) ||
		!strings.Contains(records[1].Error, "after the person agreed") {
		t.Errorf("the log reads %+v", records)
	}
}

func TestWritesTurnedOffWhileThePersonReadsAreNotMade(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_create", w.on(`{"connection": %d, "name": "a"}`)), says("Not made."))
	session := w.send("Make a", Context{})
	asked := w.question()
	if err := w.store.SavePreferences(Preferences{Effort: EffortMedium, Writes: WritesReadOnly, BodyBytes: 2048}); err != nil {
		t.Fatal(err)
	}
	w.decide(session, asked, true, false)
	w.ended()

	if created, _, _ := w.conn.done(); len(created) != 0 {
		t.Fatalf("created %v", created)
	}
	if records := w.audited(); len(records) != 1 || !strings.Contains(records[0].Error, "turned off") {
		t.Errorf("the log reads %+v", records)
	}
}

// Read only offers no write, and one asked for anyway is refused.
func TestReadOnlyOffersNoWrites(t *testing.T) {
	w := newWorld(t)
	if err := w.store.SavePreferences(Preferences{Effort: EffortMedium, Writes: WritesReadOnly, BodyBytes: 2048}); err != nil {
		t.Fatal(err)
	}
	w.plays(asks("destination_create", w.on(`{"connection": %d, "name": "a"}`)), says("I cannot."))
	session := w.send("Make a", Context{})
	w.ended()

	for _, offered := range w.model.built[0].Tools {
		if tool, _ := toolset.Lookup(offered.Name); tool.Blast != catalog.BlastRead {
			t.Errorf("read only offered %s", offered.Name)
		}
	}
	if result := w.model.chat(t, 0).results[0][0]; !result.IsError || !strings.Contains(result.Content, "turned off") {
		t.Errorf("the model was told %+v", result)
	}
	if tool := w.tools(session)[0]; tool.State != ToolFailed {
		t.Errorf("the card reads %+v", tool)
	}
}

// Stopping while a question waits answers it no, in the log as in the
// history the model reads next.
func TestAStopWhileThePersonReadsRefusesTheWrite(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("destination_create", w.on(`{"connection": %d, "name": "a"}`)))
	session := w.send("Make a", Context{})
	asked := w.question()
	if err := w.manager.Stop(session); err != nil {
		t.Fatal(err)
	}
	w.ended()

	if created, _, _ := w.conn.done(); len(created) != 0 {
		t.Fatalf("created %v", created)
	}
	if records := w.audited(); !slices.Equal(phases(records), []string{audit.PhaseRefused}) ||
		!strings.Contains(records[0].Error, "stopped") {
		t.Errorf("the log reads %+v", records)
	}
	if results := w.model.chat(t, 0).results; len(results) != 1 || !results[0][0].IsError {
		t.Errorf("the call went unanswered: %+v", results)
	}
	if last := w.last(session); last.Notice != NoticeStopped {
		t.Errorf("the conversation ends with %+v", last)
	}
	if err := w.manager.Decide(session, asked.Tool.Ask.ID, true, false); err == nil {
		t.Error("a question the stop answered took another answer")
	}
}

func TestAStopEndsATurnMidStream(t *testing.T) {
	w := newWorld(t)
	w.plays(func(ctx context.Context, delta func(provider.Delta)) (provider.Turn, error) {
		delta(provider.Delta{Text: "Let me look"})
		<-ctx.Done()
		return provider.Turn{}, ctx.Err()
	})
	session := w.send("Look", Context{})
	w.until(func(event Event) bool { return event.Kind == EventItem && event.Item.Kind == ItemText })
	if err := w.manager.Stop(session); err != nil {
		t.Fatal(err)
	}
	w.ended()

	items := w.snapshot(session).Items
	if len(items) != 3 || items[1].Text != "Let me look" || items[2].Notice != NoticeStopped {
		t.Errorf("the conversation reads %+v", items)
	}
}

// A run stops at its tool limit, and every call it does not make is still
// answered, as the next turn has to find.
func TestARunStopsAtItsToolLimit(t *testing.T) {
	w := newWorld(t)
	w.manager.limit = 2
	detail := w.on(`{"connection": %d, "name": "orders"}`)
	w.plays(asks("destination_detail", detail, "destination_detail", detail, "destination_detail", detail))
	session := w.send("Look three times", Context{})
	w.ended()

	results := w.model.chat(t, 0).results[0]
	if len(results) != 3 || results[0].IsError || results[1].IsError || !results[2].IsError ||
		!strings.Contains(results[2].Content, "at most 2 tools") {
		t.Fatalf("handed the model %+v", results)
	}
	if last := w.last(session); last.Notice != NoticeLimit || last.Text != "2" {
		t.Errorf("the conversation ends with %+v", last)
	}
	if w.model.next != 1 {
		t.Errorf("the model was asked for %d turns", w.model.next)
	}
}

func TestAMistakenCallIsTheModelsToCorrect(t *testing.T) {
	w := newWorld(t)
	w.plays(asks("nope", `{}`, "destination_detail", `{"connection": "scratch"}`), says("Sorry."))
	session := w.send("Look", Context{})
	w.ended()

	results := w.model.chat(t, 0).results[0]
	if !results[0].IsError || !strings.Contains(results[0].Content, `no tool named "nope"`) ||
		!results[1].IsError || !strings.Contains(results[1].Content, "do not fit destination_detail") {
		t.Fatalf("handed the model %+v", results)
	}
	if last := w.last(session); last.Text != "Sorry." {
		t.Errorf("the run did not carry on: %+v", last)
	}
}

// A turn cut off at its length can end in a call written half way, which is
// not run.
func TestACallInATurnCutShortIsNotRun(t *testing.T) {
	w := newWorld(t)
	w.plays(func(context.Context, func(provider.Delta)) (provider.Turn, error) {
		return provider.Turn{Stop: provider.StopLength, Calls: []provider.Call{{
			ID: "c1", Name: "destination_create", Input: json.RawMessage(w.on(`{"connection": %d, "na`)),
		}}}, nil
	})
	session := w.send("Make a", Context{})
	w.ended()

	if results := w.model.chat(t, 0).results; len(results) != 1 || !results[0][0].IsError {
		t.Fatalf("handed the model %+v", results)
	}
	tool := w.tools(session)[0]
	var input string
	if tool.State != ToolSkipped || json.Unmarshal(tool.Input, &input) != nil {
		t.Errorf("the card reads %+v", tool)
	}
	if last := w.last(session); last.Notice != NoticeLength {
		t.Errorf("the conversation ends with %+v", last)
	}
}

/*
 * A run the service failed is retried by sending again, against the settings
 * as they are by then: a conversation nothing has answered yet is set up
 * afresh, model and all, and told everything said so far.
 */
func TestAFailedRunIsRetriedWithTheSettingsAsTheyAreNow(t *testing.T) {
	w := newWorld(t)
	w.plays(func(context.Context, func(provider.Delta)) (provider.Turn, error) {
		return provider.Turn{}, &provider.Failure{Reason: provider.ReasonNotFound, Status: 404, Detail: "no such model"}
	}, says("Hello."))
	session := w.send("hi", Context{})
	w.ended()
	if last := w.last(session); last.Notice != NoticeFailed || last.Reason != string(provider.ReasonNotFound) ||
		last.Text != "no such model" {
		t.Fatalf("the conversation ends with %+v", last)
	}

	if _, err := w.store.SaveProvider(
		Provider{ID: w.provider, Name: "local", Kind: provider.OpenAI, Model: "qwen3:14b"}, KeyPreserve); err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Send(session, "hello again", Context{}); err != nil {
		t.Fatal(err)
	}
	if ended := w.ended(); ended.Model != "qwen3:14b" {
		t.Errorf("the run ended on %q", ended.Model)
	}
	if len(w.model.built) != 2 || w.model.built[1].Model != "qwen3:14b" || len(w.model.chat(t, 1).said) != 2 {
		t.Errorf("built %+v, the second told %q", w.model.built, w.model.chat(t, 1).said)
	}
}

// Once the model has answered, the history is its own: a key replaced since
// reaches the same chat rather than a new one.
func TestAnAnsweredConversationKeepsItsChat(t *testing.T) {
	w := newWorld(t)
	w.plays(says("One."), says("Two."))
	session := w.send("first", Context{})
	w.ended()
	if _, err := w.store.SaveProvider(Provider{ID: w.provider, Name: "local", Kind: provider.OpenAI, Model: "other",
		APIKey: "k2"}, KeyReplace); err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Send(session, "second", Context{}); err != nil {
		t.Fatal(err)
	}
	w.ended()

	chat := w.model.chat(t, 0)
	if len(w.model.built) != 1 || len(chat.said) != 2 || len(chat.reached) != 1 || chat.reached[0].APIKey != "k2" {
		t.Errorf("built %d chats; the first was told %q and reached %+v", len(w.model.built), chat.said, chat.reached)
	}
	if snapshot := w.snapshot(session); snapshot.Model != "qwen3" {
		t.Errorf("an answered conversation moved to %q", snapshot.Model)
	}
}

func TestWhereThePersonWasComesWithWhatTheySaid(t *testing.T) {
	w := newWorld(t)
	w.plays(says("Fine."))
	where := Context{Connection: w.id, Page: "topics", Selected: &Selection{Kind: "topic", Name: "orders"}}
	session := w.send("  Why is it slow?\n", where)
	w.ended()

	want := fmt.Sprintf("<context>\nconnection: \"scratch\" (id %d, rabbitmq, open in the window)\npage: topics\n"+
		"selected: topic \"orders\"\ninterface language: %s\ntime: 2026-10-01 14:03 CST, UTC+08:00\n</context>\n\n"+
		"Why is it slow?", w.id, w.services.Settings.GetSettings().Language)
	if said := w.model.chat(t, 0).said; len(said) != 1 || said[0] != want {
		t.Errorf("the model was told %q", said)
	}
	first := w.snapshot(session).Items[0]
	if first.Text != "Why is it slow?" || first.Context == nil || first.Context.Selected.Name != "orders" {
		t.Errorf("the conversation starts with %+v", first)
	}
	if summaries := w.sessions(); len(summaries) != 1 || summaries[0].Title != "Why is it slow?" ||
		summaries[0].Connection == nil || summaries[0].Connection.Name != "scratch" || !summaries[0].Open {
		t.Errorf("listed %+v", summaries)
	}
	if w.model.built[0].System != system || w.model.built[0].Effort != string(EffortMedium) {
		t.Errorf("set up with %+v", w.model.built[0])
	}
}

func TestOneRunGoesAtATime(t *testing.T) {
	w := newWorld(t)
	release := make(chan struct{})
	w.plays(func(ctx context.Context, delta func(provider.Delta)) (provider.Turn, error) {
		<-release
		return says("Done.")(ctx, delta)
	})
	first := w.send("a", Context{})
	second, err := w.manager.Start("")
	if err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Send(second.ID, "b", Context{}); err == nil || !strings.Contains(err.Error(), "another") {
		t.Errorf("a second conversation ran beside the first: %v", err)
	}
	if err := w.manager.Send(first, "c", Context{}); err == nil || !strings.Contains(err.Error(), "still answering") {
		t.Errorf("a conversation ran twice at once: %v", err)
	}
	// The second has nothing said in it yet, so it is not listed.
	if summaries := w.sessions(); len(summaries) != 1 || summaries[0].ID != first || !summaries[0].Running {
		t.Errorf("listed %+v", summaries)
	}
	close(release)
	w.ended()
}

/*
 * The window builds a conversation from its events and, when it misses one,
 * from a snapshot. The two have to agree, item for item, or a window that
 * reloaded would show something else than one that watched.
 */
func TestTheEventsBuildWhatTheSnapshotHolds(t *testing.T) {
	w := newWorld(t)
	w.manager.tick = time.Millisecond
	w.plays(func(_ context.Context, delta func(provider.Delta)) (provider.Turn, error) {
		delta(provider.Delta{Thinking: true, Text: "Look"})
		delta(provider.Delta{Thinking: true, Text: "ing."})
		delta(provider.Delta{Text: "It is "})
		time.Sleep(10 * time.Millisecond)
		delta(provider.Delta{Text: "fine."})
		return provider.Turn{Stop: provider.StopDone, Usage: provider.Usage{Input: 7, Output: 3}}, nil
	})
	session := w.send("How is it?", Context{})
	ended := w.ended()

	var order []string
	built := map[string]Item{}
	for i, event := range w.seen {
		if event.Seq != int64(i+1) || event.Session != session {
			t.Fatalf("event %d is numbered %d for %q", i, event.Seq, event.Session)
		}
		switch event.Kind {
		case EventItem:
			if _, known := built[event.Item.ID]; !known {
				order = append(order, event.Item.ID)
			}
			built[event.Item.ID] = *event.Item
		case EventDelta:
			item := built[event.ItemID]
			item.Text += event.Text
			built[event.ItemID] = item
		}
	}
	snapshot := w.snapshot(session)
	if snapshot.Seq != int64(len(w.seen)) || len(order) != len(snapshot.Items) {
		t.Fatalf("the snapshot is at %d with %d items; the events made %d of %d", snapshot.Seq,
			len(snapshot.Items), len(order), len(w.seen))
	}
	for i, id := range order {
		watched, _ := json.Marshal(built[id])
		reloaded, _ := json.Marshal(snapshot.Items[i])
		if string(watched) != string(reloaded) {
			t.Errorf("item %d watched %s, reloaded %s", i, watched, reloaded)
		}
	}
	if snapshot.Items[1].Kind != ItemThinking || snapshot.Items[1].Text != "Looking." ||
		snapshot.Items[2].Text != "It is fine." {
		t.Errorf("the conversation reads %+v", snapshot.Items)
	}
	if ended.Usage == nil || ended.Usage.Input != 7 || snapshot.Usage.Output != 3 {
		t.Errorf("spent %+v", ended.Usage)
	}
}

func TestNothingIsSentBeforeThePersonAgrees(t *testing.T) {
	w := newWorld(t)
	other, err := w.store.SaveProvider(Provider{Name: "cloud", Kind: provider.OpenAI, Model: "m"}, KeyPreserve)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := w.manager.Start(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Send(summary.ID, "hello", Context{}); err == nil || !strings.Contains(err.Error(), "agrees") {
		t.Errorf("sent before the person agreed: %v", err)
	}
	if len(w.model.built) != 0 {
		t.Errorf("a chat was built: %+v", w.model.built)
	}
}

/*
 * A run that ended without an answer - the service failed, the person
 * stopped it, the tool limit - is carried on from where it was, without
 * anything new said. One that answered is not: there is nothing to carry on.
 */
func TestARunIsCarriedOnFromWhereItEnded(t *testing.T) {
	w := newWorld(t)
	w.plays(func(context.Context, func(provider.Delta)) (provider.Turn, error) {
		return provider.Turn{}, &provider.Failure{Reason: provider.ReasonRateLimited, Detail: "slow down"}
	}, says("Here it is."))
	session := w.send("How deep is orders?", Context{})
	w.ended()
	if err := w.manager.Continue(session); err != nil {
		t.Fatal(err)
	}
	w.ended()

	if last := w.last(session); last.Text != "Here it is." {
		t.Fatalf("the conversation ends with %+v", last)
	}
	if said := w.model.chat(t, 1).said; len(said) != 1 || !strings.HasSuffix(said[0], "How deep is orders?") {
		t.Errorf("the second chat was told %q", said)
	}
	users := 0
	for _, item := range w.snapshot(session).Items {
		if item.Kind == ItemUser {
			users++
		}
	}
	if users != 1 {
		t.Errorf("carrying on said something: %d messages from the person", users)
	}
	if err := w.manager.Continue(session); err == nil {
		t.Error("an answered conversation was carried on")
	}
}
