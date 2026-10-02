package assistant

import (
	"encoding/json"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/provider"
)

/*
 * A conversation, as the window draws it, is a list of items. Every change to
 * one is an Event, numbered in the order it happened; a window that missed
 * one, or opened late, asks for a Snapshot and carries on from its number.
 */

// The kinds of item a conversation holds.
const (
	ItemUser     = "user"
	ItemText     = "text"
	ItemThinking = "thinking"
	ItemTool     = "tool"
	// ItemNotice is something the application says rather than the model.
	ItemNotice = "notice"
)

// The notices a run can end with.
const (
	// NoticeStopped is a run the person stopped.
	NoticeStopped = "stopped"
	// NoticeFailed is a run the model service failed; sending again retries.
	NoticeFailed = "failed"
	// NoticeRefused is a turn the model declined to give.
	NoticeRefused = "refused"
	// NoticeLength is a turn cut off at its token limit.
	NoticeLength = "length"
	// NoticeContext is a conversation longer than the model can take.
	NoticeContext = "context"
	// NoticeLimit is a run that called as many tools as one run may.
	NoticeLimit = "limit"
)

// The states a tool call goes through.
const (
	ToolRunning  = "running"
	ToolWaiting  = "waiting"
	ToolDone     = "done"
	ToolFailed   = "failed"
	ToolDeclined = "declined"
	ToolSkipped  = "skipped"
)

// The ways a person is asked about a tool call.
const (
	// AskApprove is a write: allowed or not, once or for the conversation.
	AskApprove = "approve"
	// AskConfirm is a destruction, confirmed every time with the question the
	// MCP server puts about it.
	AskConfirm = "confirm"
)

// The ways a write was let through.
const (
	ApprovedOnce      = "once"
	ApprovedSession   = "session"
	ApprovedConfirmed = "confirmed"
)

// Item is one entry in a conversation.
type Item struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
	// Context is what came with a person's message.
	Context *Context  `json:"context,omitempty"`
	Tool    *ToolItem `json:"tool,omitempty"`
	// Notice is which notice this is; Text says more where there is more.
	Notice string `json:"notice,omitempty"`
	// Reason is why a model service failed, for a failed notice: the reasons
	// a settings test reports.
	Reason string `json:"reason,omitempty"`
}

// ToolItem is one tool call, from the model asking to the result.
type ToolItem struct {
	Call  string          `json:"call"`
	Name  string          `json:"name"`
	Title string          `json:"title"`
	Blast string          `json:"blast,omitempty"`
	Input json.RawMessage `json:"input"`
	// Connection is the connection a write reaches, named as it was then.
	Connection *audit.Connection `json:"connection,omitempty"`
	State      string            `json:"state"`
	Ask        *Ask              `json:"ask,omitempty"`
	// Approved is how a write was let through: once, session or confirmed.
	Approved string `json:"approved,omitempty"`
	// Result is what came of it in a line: what a write changed, or why the
	// call failed or did not happen.
	Result string `json:"result,omitempty"`
	// Output is the answer for the window to show. What the model is handed
	// is cut shorter.
	Output json.RawMessage `json:"output,omitempty"`
	Millis int64           `json:"ms,omitempty"`
}

// Ask is a question waiting on a person, or one they answered.
type Ask struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Question is a confirmation's text, word for word what the audit log
	// keeps.
	Question string `json:"question,omitempty"`
	// Caveat is what the connection says survives a write succeeding, for an
	// approval, in the application's language.
	Caveat string `json:"caveat,omitempty"`
}

// Context is what the window knew about where the person was when they asked.
type Context struct {
	Connection int    `json:"connection,omitempty"`
	Page       string `json:"page,omitempty"`
	Namespace  string `json:"namespace,omitempty"`
	// Selected is what was open in a detail panel, if anything.
	Selected *Selection `json:"selected,omitempty"`
}

// Selection is one object a person had open.
type Selection struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// The kinds of event.
const (
	// EventItem adds an item or replaces it whole.
	EventItem = "item"
	// EventDelta appends text to an item.
	EventDelta = "delta"
	// EventRun says a run started or ended.
	EventRun = "run"
)

// Event is one change to a conversation.
type Event struct {
	Session string `json:"session"`
	Seq     int64  `json:"seq"`
	Kind    string `json:"kind"`
	Item    *Item  `json:"item,omitempty"`
	ItemID  string `json:"itemId,omitempty"`
	Text    string `json:"text,omitempty"`
	// Running is whether a run is going, on a run event.
	Running bool `json:"running"`
	// Model is the model the conversation runs on, on a run event. It follows
	// the settings until the model has answered once.
	Model string `json:"model,omitempty"`
	// Usage is what the conversation has spent, on the event that ends a run.
	Usage *provider.Usage `json:"usage,omitempty"`
}

// Snapshot is a whole conversation as of one event.
type Snapshot struct {
	Session string         `json:"session"`
	Seq     int64          `json:"seq"`
	Running bool           `json:"running"`
	Model   string         `json:"model"`
	Items   []Item         `json:"items"`
	Usage   provider.Usage `json:"usage"`
}

// Summary is a conversation as a list of them shows it.
type Summary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Provider is the model service it runs on.
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Running  bool   `json:"running"`
}

// clone copies an item deep enough that the copy can be read while the
// original changes.
func (i Item) clone() Item {
	if i.Context != nil {
		context := *i.Context
		if context.Selected != nil {
			selected := *context.Selected
			context.Selected = &selected
		}
		i.Context = &context
	}
	if i.Tool != nil {
		tool := *i.Tool
		if tool.Connection != nil {
			connection := *tool.Connection
			tool.Connection = &connection
		}
		if tool.Ask != nil {
			ask := *tool.Ask
			tool.Ask = &ask
		}
		i.Tool = &tool
	}
	return i
}
