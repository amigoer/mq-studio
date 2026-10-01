package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
	"github.com/amigoer/mq-studio/internal/model"
)

var (
	errDeclined = errors.New("not done: the person declined it, so it should not be tried again " +
		"unless they ask for it")
	errUnanswered = errors.New("not done: the person stopped the conversation before answering")
	errWritesOff  = errors.New("not done: writes were turned off in the assistant's settings")
)

// ending is how a run ended, where it did not end with an answer.
type ending struct {
	notice, detail, reason string
}

// run answers what the person said, in as many turns as it takes.
func (m *Manager) run(ctx context.Context, s *session) {
	ended := m.converse(ctx, s)

	m.mu.Lock()
	defer m.mu.Unlock()
	if ended != nil {
		m.addLocked(s, Item{Kind: ItemNotice, Notice: ended.notice, Text: ended.detail, Reason: ended.reason})
	}
	s.cancel()
	s.cancel, m.running = nil, nil
	usage := s.usage
	m.emitLocked(s, Event{Kind: EventRun, Model: s.model, Usage: &usage})
}

func (m *Manager) converse(ctx context.Context, s *session) *ending {
	settings, err := m.store.Settings()
	if err != nil {
		return failure(ctx, err)
	}
	index := settings.index(s.provider)
	if index < 0 {
		return &ending{notice: NoticeFailed,
			detail: "the model service this conversation runs on has been removed; start a new conversation"}
	}
	setup := m.prepare(settings)
	chat, err := m.ready(ctx, s, settings.Providers[index], settings.Effort, setup)
	if err != nil {
		return failure(ctx, err)
	}

	ctx = toolset.WithCaller(ctx, toolset.Caller{Confirms: true})
	calls := 0
	for {
		turn, err := m.turn(ctx, s, chat)
		if err != nil {
			return failure(ctx, err)
		}
		if turn.Stop != provider.StopTools || len(turn.Calls) == 0 {
			// A turn cut short can end in a call written half way, so none
			// is run. Each is still answered: the next turn has to find a
			// result for every call in this one.
			if len(turn.Calls) > 0 {
				results := make([]provider.Result, 0, len(turn.Calls))
				for _, call := range turn.Calls {
					results = append(results, m.skip(s, call, "not run: the turn ended before this call was complete"))
				}
				chat.Results(results)
			}
			return endingOf(turn)
		}

		results := make([]provider.Result, 0, len(turn.Calls))
		limited := false
		for _, call := range turn.Calls {
			switch {
			case ctx.Err() != nil:
				results = append(results, m.skip(s, call, "not run: the person stopped the conversation"))
			case calls >= m.limit:
				limited = true
				results = append(results, m.skip(s, call,
					fmt.Sprintf("not run: one question may call at most %d tools", m.limit)))
			default:
				calls++
				results = append(results, m.call(ctx, s, setup, call))
			}
		}
		chat.Results(results)
		if ctx.Err() != nil {
			return &ending{notice: NoticeStopped}
		}
		if limited {
			return &ending{notice: NoticeLimit, detail: strconv.Itoa(m.limit)}
		}
	}
}

// endingOf is the notice a turn that asked for no tools ends its run with.
func endingOf(turn provider.Turn) *ending {
	switch turn.Stop {
	case provider.StopLength:
		return &ending{notice: NoticeLength}
	case provider.StopRefused:
		return &ending{notice: NoticeRefused, detail: turn.Explanation}
	case provider.StopContext:
		return &ending{notice: NoticeContext}
	}
	return nil
}

// failure is the ending for an error: a stop, when the person stopped the
// run, and otherwise what the service said, for sending again to retry.
func failure(ctx context.Context, err error) *ending {
	if ctx.Err() != nil {
		return &ending{notice: NoticeStopped}
	}
	var failed *provider.Failure
	if errors.As(err, &failed) {
		return &ending{notice: NoticeFailed, detail: failed.Detail, reason: string(failed.Reason)}
	}
	return &ending{notice: NoticeFailed, detail: err.Error()}
}

// setup is what one run offers the model and runs its tools against, read
// from the settings as the run starts.
type setup struct {
	env       *toolset.Env
	allow     catalog.Blast
	offered   []provider.Tool
	tools     map[string]toolset.Tool
	bodyBytes int
}

/*
 * prepare reads a run's tools from the settings.
 *
 * Read only offers the reads; otherwise every tool is offered and each write
 * waits on the person. The order is the registry's every time, so the tools
 * cache with the system prompt in front of them.
 */
func (m *Manager) prepare(settings Settings) *setup {
	allow := catalog.BlastRead
	if settings.Writes == WritesApprove {
		allow = catalog.BlastDestructive
	}
	run := &setup{allow: allow, tools: make(map[string]toolset.Tool), bodyBytes: settings.BodyBytes}
	operations := make(map[string]string)
	for _, tool := range toolset.All() {
		if tool.Operation != "" && !catalog.Permits(allow, tool.Blast) {
			continue
		}
		run.tools[tool.Name] = tool
		run.offered = append(run.offered, provider.Tool{
			Name: tool.Name, Description: tool.Description, Schema: schemaOf(tool),
		})
		if tool.Operation != "" {
			operations[tool.Operation] = tool.Name
		}
	}
	run.env = &toolset.Env{
		Services:  m.services,
		Translate: m.translate,
		Allow:     func(int) catalog.Blast { return allow },
		Offered:   operations,
	}
	return run
}

func schemaOf(tool toolset.Tool) map[string]any {
	schema := map[string]any{}
	if encoded, err := json.Marshal(tool.InputSchema); err == nil {
		_ = json.Unmarshal(encoded, &schema)
	}
	if schema == nil {
		schema = map[string]any{}
	}
	schema["type"] = "object"
	return schema
}

/*
 * ready is the conversation's chat, set up for the service as it is now.
 *
 * Until the model has answered, the conversation is only what the person
 * said, so it is built afresh every run: the settings may have been fixed
 * since the run before failed, the model with them. Once the model has
 * answered, the history is in its service's own shape, and only how the
 * service is reached - key, address, proxy - and the tools offered can change
 * under it.
 */
func (m *Manager) ready(
	ctx context.Context, s *session, chosen Provider, effort Effort, run *setup,
) (provider.Chat, error) {
	m.mu.Lock()
	queue := s.queue
	s.queue = nil
	m.mu.Unlock()

	endpoint := chosen.Endpoint()
	if !s.answered {
		s.said = append(s.said, queue...)
		chat, err := m.newChat(ctx, endpoint, provider.Options{
			Model: chosen.Model, System: system, Tools: run.offered, Effort: string(effort),
		})
		if err != nil {
			return nil, err
		}
		for _, text := range s.said {
			chat.User(text)
		}
		s.chat, s.endpoint = chat, endpoint
		m.mu.Lock()
		s.model = chosen.Model
		m.mu.Unlock()
		return chat, nil
	}

	for _, text := range queue {
		s.chat.User(text)
	}
	s.chat.Offer(run.offered)
	if endpoint != s.endpoint {
		if err := s.chat.Reach(endpoint); err != nil {
			return nil, err
		}
		s.endpoint = endpoint
	}
	return s.chat, nil
}

// turn asks for the model's next turn, streaming its text to the window.
func (m *Manager) turn(ctx context.Context, s *session, chat provider.Chat) (provider.Turn, error) {
	out := &stream{m: m, s: s}
	turn, err := chat.Next(ctx, out.add)
	out.close()
	if err != nil {
		return turn, err
	}
	s.answered, s.said = true, nil

	m.mu.Lock()
	defer m.mu.Unlock()
	s.usage.Input += turn.Usage.Input
	s.usage.Output += turn.Usage.Output
	s.usage.CacheRead += turn.Usage.CacheRead
	s.usage.CacheWrite += turn.Usage.CacheWrite
	return turn, nil
}

// stream is one turn's text on its way to the window, held for a tick so it
// goes in pieces rather than token by token.
type stream struct {
	m       *Manager
	s       *session
	pending []provider.Delta
	timer   *time.Timer
	// open is the item the text goes into, of kind.
	open, kind string
}

func (o *stream) add(delta provider.Delta) {
	if delta.Text == "" {
		return
	}
	o.m.mu.Lock()
	defer o.m.mu.Unlock()
	if n := len(o.pending); n > 0 && o.pending[n-1].Thinking == delta.Thinking {
		o.pending[n-1].Text += delta.Text
	} else {
		o.pending = append(o.pending, delta)
	}
	if o.timer == nil {
		o.timer = time.AfterFunc(o.m.tick, o.flush)
	}
}

func (o *stream) flush() {
	o.m.mu.Lock()
	defer o.m.mu.Unlock()
	o.flushLocked()
}

func (o *stream) flushLocked() {
	o.timer = nil
	for _, piece := range o.pending {
		kind := ItemText
		if piece.Thinking {
			kind = ItemThinking
		}
		if o.open == "" || o.kind != kind {
			o.open, o.kind = o.m.addLocked(o.s, Item{Kind: kind, Text: piece.Text}), kind
			continue
		}
		o.m.appendLocked(o.s, o.open, piece.Text)
	}
	o.pending = nil
}

// close sends what is left, at the end of the turn.
func (o *stream) close() {
	o.m.mu.Lock()
	defer o.m.mu.Unlock()
	if o.timer != nil {
		o.timer.Stop()
	}
	o.flushLocked()
}

func (m *Manager) appendLocked(s *session, id, text string) {
	for i := len(s.items) - 1; i >= 0; i-- {
		if s.items[i].ID == id {
			s.items[i].Text += text
			m.emitLocked(s, Event{Kind: EventDelta, ItemID: id, Text: text})
			return
		}
	}
}

// call runs one tool the model asked for, as far as it is let go, and says
// what came of it.
func (m *Manager) call(ctx context.Context, s *session, run *setup, call provider.Call) provider.Result {
	tool, offered := run.tools[call.Name]
	id := m.add(s, Item{Kind: ItemTool, Tool: card(call)})
	if !offered {
		reason := fmt.Sprintf("there is no tool named %q", call.Name)
		if _, exists := toolset.Lookup(call.Name); exists {
			reason = fmt.Sprintf("not done: %s writes, and writes are turned off in the assistant's settings", call.Name)
		}
		return m.fail(s, id, call, reason)
	}
	input, err := tool.Check(call.Input)
	if err != nil {
		return m.fail(s, id, call, fmt.Sprintf("the arguments do not fit %s: %v", call.Name, err))
	}
	if tool.Blast == catalog.BlastRead {
		began := time.Now()
		output, err := tool.Run(ctx, run.env, input)
		return m.settle(s, id, call, run, output, err, time.Since(began))
	}
	return m.write(ctx, s, run, id, call, tool, input)
}

// card is a call as the window first shows it.
func card(call provider.Call) *ToolItem {
	item := &ToolItem{Call: call.ID, Name: call.Name, Title: call.Name, Input: call.Input, State: ToolRunning}
	// A turn cut short can hand over arguments that are not JSON yet, and
	// the item has to encode whatever they are.
	if !json.Valid(call.Input) {
		item.Input, _ = json.Marshal(string(call.Input))
	}
	if tool, known := toolset.Lookup(call.Name); known {
		item.Title, item.Blast = tool.Title, string(tool.Blast)
	}
	return item
}

// skip answers a call that is not run.
func (m *Manager) skip(s *session, call provider.Call, reason string) provider.Result {
	item := card(call)
	item.State, item.Result = ToolSkipped, reason
	m.add(s, Item{Kind: ItemTool, Tool: item})
	return provider.Result{CallID: call.ID, Content: reason, IsError: true}
}

// fail ends a call that could not be made.
func (m *Manager) fail(s *session, id string, call provider.Call, reason string) provider.Result {
	m.changeTool(s, id, func(tool *ToolItem) { tool.State, tool.Result = ToolFailed, reason })
	return provider.Result{CallID: call.ID, Content: reason, IsError: true}
}

// settle keeps what a call came to for the window, and hands the model its
// share of it.
func (m *Manager) settle(
	s *session, id string, call provider.Call, run *setup, output any, err error, took time.Duration,
) provider.Result {
	if err != nil {
		m.changeTool(s, id, func(tool *ToolItem) {
			tool.State, tool.Result, tool.Millis = ToolFailed, err.Error(), took.Milliseconds()
		})
		return provider.Result{CallID: call.ID, Content: err.Error(), IsError: true}
	}
	var changed string
	if written, ok := output.(toolset.Written); ok {
		changed, _ = written.Recorded()
	}
	shown := forWindow(output)
	m.changeTool(s, id, func(tool *ToolItem) {
		tool.State, tool.Result, tool.Output, tool.Millis = ToolDone, changed, shown, took.Milliseconds()
	})
	return provider.Result{CallID: call.ID, Content: forModel(output, run.bodyBytes)}
}

/*
 * write is every check a write passes before it is made, and the records
 * either side of it: the window's half of what the MCP server's guarded does.
 *
 * There is no allowance per connection here. The person is asked about each
 * write - once, or once for the conversation - and about each destruction
 * every time, and their answer is the whole of the permission.
 */
func (m *Manager) write(
	ctx context.Context, s *session, run *setup, id string, call provider.Call, tool toolset.Tool, input any,
) provider.Result {
	target := input.(toolset.Targeted).Target()
	connection := m.auditConnection(target)
	record := audit.Record{
		Session:    s.id,
		Call:       m.journal.Next(),
		Client:     m.client,
		Tool:       tool.Name,
		Operation:  tool.Operation,
		Blast:      string(tool.Blast),
		Connection: connection,
		Allow:      string(run.allow),
		Arguments:  toolset.Arguments(input),
	}
	m.changeTool(s, id, func(item *ToolItem) { item.Connection = &connection })
	refuse := func(state string, err error) provider.Result {
		m.journal.Keep(record.Refused(err))
		m.changeTool(s, id, func(item *ToolItem) { item.State, item.Result = state, err.Error() })
		return provider.Result{CallID: call.ID, Content: err.Error(), IsError: true}
	}

	var (
		agreed   *model.ConnectionProfile
		approved string
	)
	switch {
	case tool.Blast == catalog.BlastDestructive:
		question, profile, err := run.env.Question(ctx, tool, input)
		if err == nil {
			err = m.journal.Before(record.Asked(question))
		}
		if err != nil {
			return refuse(ToolFailed, err)
		}
		answer, err := m.ask(ctx, s, id, Ask{Kind: AskConfirm, Question: question})
		if err != nil {
			return refuse(ToolSkipped, err)
		}
		if !answer.approve {
			return refuse(ToolDeclined, errDeclined)
		}
		agreed, approved = &profile, ApprovedConfirmed
	case s.remembered[tool.Name]:
		approved = ApprovedSession
	default:
		caveat, err := run.env.Consequence(tool, input)
		if err != nil {
			return refuse(ToolFailed, err)
		}
		answer, err := m.ask(ctx, s, id, Ask{Kind: AskApprove, Caveat: caveat})
		if err != nil {
			return refuse(ToolSkipped, err)
		}
		if !answer.approve {
			return refuse(ToolDeclined, errDeclined)
		}
		approved = ApprovedOnce
		if answer.remember {
			s.remembered[tool.Name], approved = true, ApprovedSession
		}
	}
	if agreed == nil {
		record.Approved = approved
	}

	// Writes may have been turned off, or the connection pointed elsewhere,
	// while the person read.
	settings, err := m.store.Settings()
	if err != nil {
		return refuse(ToolFailed, err)
	}
	if settings.Writes != WritesApprove {
		return refuse(ToolFailed, errWritesOff)
	}
	if agreed != nil {
		if err := run.env.ChangedSince(target, *agreed); err != nil {
			return refuse(ToolFailed, err)
		}
	}
	if err := m.journal.Before(record.Started(agreed != nil)); err != nil {
		return refuse(ToolFailed, err)
	}
	m.changeTool(s, id, func(item *ToolItem) { item.State, item.Approved = ToolRunning, approved })

	// A stop does not cut a write off half way, which would leave whether the
	// broker acted anybody's guess. The request timeout still bounds it.
	began := time.Now()
	output, err := tool.Run(context.WithoutCancel(ctx), run.env, input)
	took := time.Since(began)
	m.journal.Keep(record.Finished(output, err, took))
	return m.settle(s, id, call, run, output, err, took)
}

// ask puts a question to the person and waits for the answer, or for the
// run to be stopped.
func (m *Manager) ask(ctx context.Context, s *session, id string, ask Ask) (decision, error) {
	answer := make(chan decision, 1)
	ask.ID = id
	m.mu.Lock()
	s.asks[id] = answer
	m.changeLocked(s, id, func(item *Item) { item.Tool.State, item.Tool.Ask = ToolWaiting, &ask })
	m.mu.Unlock()

	select {
	case decided := <-answer:
		return decided, nil
	case <-ctx.Done():
		// An answer that lands with the stop loses to it.
		m.mu.Lock()
		delete(s.asks, id)
		m.mu.Unlock()
		return decision{}, errUnanswered
	}
}

func (m *Manager) auditConnection(id int) audit.Connection {
	connection := audit.Connection{ID: id}
	if m.services == nil || m.services.Connections == nil {
		return connection
	}
	if profile, err := m.services.Connections.GetConnection(id); err == nil {
		connection.Name, connection.Family = profile.Name, string(profile.Kind)
	}
	return connection
}
