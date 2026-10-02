// Package audit is the audit log: every write an agent asks for - done,
// failed or refused - appended to a file beside the application's settings.
//
// The agent's own transcript belongs to whatever shows it. It is compacted,
// cleared or lost with the session, and it is the last place anybody looks to
// find out what emptied a queue. This is the application's own record, and it
// outlives whichever agent made the call - the MCP server's or the window's
// assistant's, which write the same file.
//
// A write is recorded before it is made, and one that cannot be recorded is
// not made. A process that dies half way leaves a start with no outcome after
// it, which is the truth: nobody knows whether the broker acted.
//
// Nothing rewrites the file whole. Every record is one append of one line, so
// two processes writing at once land before or after each other, never inside.
package audit

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/toolset"
)

// The phases a write goes through in the log. A started write is followed by
// done or failed; a refused one never started. A destructive one is asked
// first, and its answer - refused or started - carries the same call number.
const (
	PhaseAsked   = "asked"
	PhaseRefused = "refused"
	PhaseStarted = "started"
	PhaseDone    = "done"
	PhaseFailed  = "failed"
)

// Journal appends one JSON object per line to the audit log.
type Journal struct {
	path  string
	calls atomic.Int64
	mu    sync.Mutex
}

// Open keeps the log at path. Nothing is written until there is a record.
func Open(path string) *Journal {
	return &Journal{path: path}
}

// Path is where the log is kept.
func (j *Journal) Path() string { return j.path }

// NewSession names one writer's records, telling them from another's in the
// same file: every agent client starts an MCP server of its own, and the
// window's assistant holds several conversations.
func NewSession() string {
	var raw [6]byte
	_, _ = rand.Read(raw[:])
	return hex.EncodeToString(raw[:])
}

// Record is one line of the audit log.
type Record struct {
	Time       string     `json:"time"`
	Session    string     `json:"session"`
	Call       int64      `json:"call"`
	Phase      string     `json:"phase"`
	Client     string     `json:"client,omitempty"`
	Tool       string     `json:"tool"`
	Operation  string     `json:"operation"`
	Blast      string     `json:"blast"`
	Connection Connection `json:"connection"`
	// Allow is how far the connection could go at the time, which is what
	// makes a refusal readable afterwards.
	Allow     string          `json:"allow"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
	// Question is what the person was shown, word for word, and Confirmed
	// marks a write they said yes to.
	Question  string `json:"question,omitempty"`
	Confirmed bool   `json:"confirmed,omitzero"`
	// Approved is how a person let a write through that put no question:
	// "once" for this call, "session" for every call of its kind in the
	// conversation.
	Approved  string `json:"approved,omitempty"`
	Changed   string `json:"changed,omitempty"`
	Reference string `json:"reference,omitempty"`
	Error     string `json:"error,omitempty"`
	Millis    *int64 `json:"ms,omitzero"`
}

// Connection is a connection as it was named when the write was made. The id
// alone would not survive the connection being deleted or renamed.
type Connection struct {
	ID     int    `json:"id"`
	Name   string `json:"name,omitempty"`
	Family string `json:"family,omitempty"`
}

// Append writes one record as one line, and syncs it before returning: a
// record a write waits on has to be on disk before the write is made.
//
// The file is opened for each record rather than held, so a log somebody
// moved aside is started afresh instead of written into one nobody can see.
func (j *Journal) Append(record Record) error {
	if j.path == "" {
		return errors.New("there is no data directory to keep it in")
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
	// One write per line: with O_APPEND, another writer appending at the same
	// moment lands before or after it, never inside it.
	if _, err := file.Write(append(line, '\n')); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Sync(); err != nil {
		return errors.Join(err, file.Close())
	}
	return file.Close()
}

// Before appends a record a write waits on. When it cannot, the write is not
// made, and the error says so in words a caller can pass on.
func (j *Journal) Before(record Record) error {
	if err := j.Append(record); err != nil {
		return fmt.Errorf("not done: every write is recorded before it is made, and the audit log "+
			"%s could not be written: %w", j.path, err)
	}
	return nil
}

// Keep appends a record nothing waits on. One that cannot be written goes to
// stderr whole, so what happened is not lost with it.
func (j *Journal) Keep(record Record) {
	if err := j.Append(record); err != nil {
		line, _ := json.Marshal(record)
		log.Printf("[agent] could not add to the audit log %s: %v; the record was %s", j.path, err, line)
	}
}

// Next numbers a call to a write tool, for this journal's writer.
func (j *Journal) Next() int64 {
	return j.calls.Add(1)
}

// Asked is the record of a question put to a person.
func (r Record) Asked(question string) Record {
	r.Phase, r.Question = PhaseAsked, question
	return r
}

// Started is the record of a write about to be made.
func (r Record) Started(confirmed bool) Record {
	r.Phase, r.Confirmed = PhaseStarted, confirmed
	return r
}

// Refused is the record of a write that was not made.
func (r Record) Refused(err error) Record {
	r.Phase, r.Error = PhaseRefused, err.Error()
	return r
}

// Finished is the outcome of a started write. The arguments stay with the
// start, which the call number ties this to.
func (r Record) Finished(output any, err error, took time.Duration) Record {
	r.Arguments = nil
	r.Millis = new(took.Milliseconds())
	if err != nil {
		r.Phase, r.Error = PhaseFailed, err.Error()
		return r
	}
	r.Phase = PhaseDone
	if answer, ok := output.(toolset.Written); ok {
		r.Changed, r.Reference = answer.Recorded()
	}
	return r
}
