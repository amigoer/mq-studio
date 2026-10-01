package mcpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The audit log: every write an agent asks for - done, failed or refused -
 * appended to a file beside the application's settings.
 *
 * The agent client shows its own tool calls, but that transcript belongs to
 * the client. It is compacted, cleared or lost with the session, and it is
 * the last place anybody looks to find out what emptied a queue. This is the
 * application's own record, and it outlives whichever agent made the call.
 *
 * A write is recorded before it is made, and one that cannot be recorded is
 * not made. A process that dies half way leaves a start with no outcome after
 * it, which is the truth: nobody knows whether the broker acted.
 *
 * It is the one file this process writes, and the window never does, so there
 * is no whole-file rewrite to race - every record is a single append.
 */

// The phases a write goes through in the log. A started write is followed by
// done or failed; a refused one never started. A destructive one is asked
// first, and its answer - refused or started - carries the same call number.
const (
	phaseAsked   = "asked"
	phaseRefused = "refused"
	phaseStarted = "started"
	phaseDone    = "done"
	phaseFailed  = "failed"
)

// journal appends one JSON object per line to the audit log.
type journal struct {
	path string
	// session tells this server's records from another's in the same file,
	// since every agent client starts a server of its own.
	session string
	calls   atomic.Int64
	mu      sync.Mutex
}

func newJournal(path string) *journal {
	var raw [6]byte
	_, _ = rand.Read(raw[:])
	return &journal{path: path, session: hex.EncodeToString(raw[:])}
}

// auditPath is where the audit log lives: in the directory the window keeps
// its own files in, which is where somebody looking for it would look.
func auditPath(services *app.Services) string {
	if services == nil || services.Settings == nil {
		return ""
	}
	return layout.In(services.Settings.DataDirectory()).AgentAuditFile
}

// auditRecord is one line of the audit log.
type auditRecord struct {
	Time       string          `json:"time"`
	Session    string          `json:"session"`
	Call       int64           `json:"call"`
	Phase      string          `json:"phase"`
	Client     string          `json:"client,omitempty"`
	Tool       string          `json:"tool"`
	Operation  string          `json:"operation"`
	Blast      string          `json:"blast"`
	Connection auditConnection `json:"connection"`
	// Allow is how far the connection could go at the time, which is what
	// makes a refusal readable afterwards.
	Allow     string          `json:"allow"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
	// Question is what the person was shown, word for word, and Confirmed
	// marks a write they said yes to.
	Question  string `json:"question,omitempty"`
	Confirmed bool   `json:"confirmed,omitzero"`
	Changed   string `json:"changed,omitempty"`
	Reference string `json:"reference,omitempty"`
	Error     string `json:"error,omitempty"`
	Millis    *int64 `json:"ms,omitzero"`
}

// auditConnection is a connection as it was named when the write was made.
// The id alone would not survive the connection being deleted or renamed.
type auditConnection struct {
	ID     int    `json:"id"`
	Name   string `json:"name,omitempty"`
	Family string `json:"family,omitempty"`
}

// append writes one record as one line, and syncs it before returning: a
// record a write waits on has to be on disk before the write is made.
//
// The file is opened for each record rather than held, so a log somebody
// moved aside is started afresh instead of written into one nobody can see.
func (j *journal) append(record auditRecord) error {
	if j.path == "" {
		return errors.New("this server has no data directory to keep it in")
	}
	record.Time = time.Now().Format(time.RFC3339Nano)
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}

	j.mu.Lock()
	defer j.mu.Unlock()
	file, err := os.OpenFile(j.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	// One write per line: with O_APPEND, another server appending at the same
	// moment lands before or after it, never inside it.
	if _, err := file.Write(append(line, '\n')); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Sync(); err != nil {
		return errors.Join(err, file.Close())
	}
	return file.Close()
}

// before appends a record a write waits on. When it cannot, the write is not
// made, and the error says so in words a caller can pass on.
func (j *journal) before(record auditRecord) error {
	if err := j.append(record); err != nil {
		return fmt.Errorf("not done: every write is recorded before it is made, and the audit log "+
			"%s could not be written: %w", j.path, err)
	}
	return nil
}

// keep appends a record nothing waits on. One that cannot be written goes to
// stderr whole, so what happened is not lost with it.
func (j *journal) keep(record auditRecord) {
	if err := j.append(record); err != nil {
		line, _ := json.Marshal(record)
		log.Printf("[mcp] could not add to the audit log %s: %v; the record was %s", j.path, err, line)
	}
}

// next numbers a call to a write tool within this session.
func (j *journal) next() int64 {
	return j.calls.Add(1)
}

// entry starts the records for one call to a write tool.
func (s *server) entry(
	request *mcp.CallToolRequest, tool string, operation catalog.Operation, id int, input any, call int64,
) auditRecord {
	allow, _ := s.ceiling(id)
	return auditRecord{
		Session:    s.journal.session,
		Call:       call,
		Client:     clientOf(request),
		Tool:       tool,
		Operation:  operation.ID,
		Blast:      string(operation.Blast),
		Connection: s.auditConnection(id),
		Allow:      string(allow),
		Arguments:  toolset.Arguments(input),
	}
}

func (r auditRecord) asked(question string) auditRecord {
	r.Phase, r.Question = phaseAsked, question
	return r
}

func (r auditRecord) started(confirmed bool) auditRecord {
	r.Phase, r.Confirmed = phaseStarted, confirmed
	return r
}

func (r auditRecord) refused(err error) auditRecord {
	r.Phase, r.Error = phaseRefused, err.Error()
	return r
}

// finished is the outcome of a started write. The arguments stay with the
// start, which the call number ties this to.
func (r auditRecord) finished(output any, err error, took time.Duration) auditRecord {
	r.Arguments = nil
	r.Millis = new(took.Milliseconds())
	if err != nil {
		r.Phase, r.Error = phaseFailed, err.Error()
		return r
	}
	r.Phase = phaseDone
	if answer, ok := output.(toolset.Written); ok {
		r.Changed, r.Reference = answer.Recorded()
	}
	return r
}

// clientOf names the agent client as it introduced itself.
func clientOf(request *mcp.CallToolRequest) string {
	if request == nil || request.Session == nil {
		return ""
	}
	params := request.Session.InitializeParams()
	if params == nil || params.ClientInfo == nil {
		return ""
	}
	return strings.TrimSpace(params.ClientInfo.Name + " " + params.ClientInfo.Version)
}

func (s *server) auditConnection(id int) auditConnection {
	connection := auditConnection{ID: id}
	if s.services.Connections == nil {
		return connection
	}
	if profile, err := s.services.Connections.GetConnection(id); err == nil {
		connection.Name, connection.Family = profile.Name, string(profile.Kind)
	}
	return connection
}
