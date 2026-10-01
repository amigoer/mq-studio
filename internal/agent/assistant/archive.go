package assistant

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/storage/atomicfile"
)

/*
 * Archive keeps the window's conversations on disk, so one can be taken up
 * again after the window has closed.
 *
 * Each conversation is a file of its own, encrypted whole with the key the
 * connection secrets use and bound to the conversation it holds, so one
 * copied over another does not decrypt. An index encrypted the same way
 * summarises them for the history list, which would otherwise decrypt every
 * conversation to show their titles. The index is only ever a summary: one
 * that is missing or unreadable is built again from the files.
 */
type Archive struct {
	directory string

	mu     sync.Mutex
	index  map[string]entry
	loaded bool
}

// entry is one conversation in the index.
type entry struct {
	Summary
	Seq int64 `json:"seq"`
}

// OpenArchive keeps conversations in directory. Nothing is read until asked.
func OpenArchive(directory string) *Archive {
	return &Archive{directory: directory}
}

// record is one conversation as it is written.
type record struct {
	Version    int               `json:"version"`
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Provider   string            `json:"provider"`
	Model      string            `json:"model"`
	Connection *audit.Connection `json:"connection,omitempty"`
	Created    time.Time         `json:"created"`
	Updated    time.Time         `json:"updated"`
	Items      []Item            `json:"items"`
	Usage      provider.Usage    `json:"usage"`
	// Answered and Said are what a conversation the model never answered
	// is built again from: what the person said, as the model was handed it.
	Answered bool     `json:"answered"`
	Said     []string `json:"said,omitempty"`
	// History is the conversation in the model service's own shape.
	History json.RawMessage `json:"history,omitempty"`
	// Seq orders two writes of one conversation: the later one wins.
	Seq int64 `json:"seq"`
}

const archiveVersion = 1

func (r record) entry() entry {
	return entry{Summary: Summary{
		ID: r.ID, Title: r.Title, Provider: r.Provider, Model: r.Model,
		Connection: r.Connection, Created: r.Created, Updated: r.Updated,
	}, Seq: r.Seq}
}

// Conversation ids are minted by the manager, and arrive back from the
// renderer: only that shape is ever made into a path.
var archivedID = regexp.MustCompile(`^[0-9a-f]{12}$`)

func (a *Archive) path(id string) (string, error) {
	if !archivedID.MatchString(id) {
		return "", fmt.Errorf("%q is not a conversation", id)
	}
	return filepath.Join(a.directory, id+".json"), nil
}

func (a *Archive) indexPath() string { return filepath.Join(a.directory, "index.json") }

func sessionField(id string) string { return "agent/session/" + id }

const indexField = "agent/sessions"

// Save writes a conversation, unless a later write of it is already there.
func (a *Archive) Save(r record) error {
	path, err := a.path(r.ID)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.loadLocked(); err != nil {
		return err
	}
	if kept, ok := a.index[r.ID]; ok && kept.Seq > r.Seq {
		return nil
	}
	r.Version = archiveVersion
	if err := writeSealed(path, r, sessionField(r.ID)); err != nil {
		return err
	}
	a.index[r.ID] = r.entry()
	return a.writeIndexLocked()
}

// Load reads a conversation back.
func (a *Archive) Load(id string) (record, error) {
	path, err := a.path(id)
	if err != nil {
		return record{}, err
	}
	var r record
	if err := readSealed(path, &r, sessionField(id)); err != nil {
		return record{}, err
	}
	if r.Version > archiveVersion {
		return record{}, errors.New("this conversation was saved by a newer version of this application")
	}
	return r, nil
}

// List summarises the conversations kept, in no order.
func (a *Archive) List() ([]Summary, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.loadLocked(); err != nil {
		return nil, err
	}
	summaries := make([]Summary, 0, len(a.index))
	for _, kept := range a.index {
		summaries = append(summaries, kept.Summary)
	}
	return summaries, nil
}

// Delete forgets a conversation. It leaves the list first, so a file that
// cannot be removed is at least no longer offered.
func (a *Archive) Delete(id string) error {
	path, err := a.path(id)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.loadLocked(); err != nil {
		return err
	}
	delete(a.index, id)
	if err := a.writeIndexLocked(); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Prune deletes every conversation last touched before cutoff, except those
// keep names.
func (a *Archive) Prune(cutoff time.Time, keep func(id string) bool) error {
	a.mu.Lock()
	var expired []string
	if err := a.loadLocked(); err != nil {
		a.mu.Unlock()
		return err
	}
	for id, kept := range a.index {
		if kept.Updated.Before(cutoff) && (keep == nil || !keep(id)) {
			expired = append(expired, id)
		}
	}
	a.mu.Unlock()
	var failures []error
	for _, id := range expired {
		failures = append(failures, a.Delete(id))
	}
	return errors.Join(failures...)
}

func (a *Archive) loadLocked() error {
	if a.loaded {
		return nil
	}
	var stored struct {
		Version  int     `json:"version"`
		Sessions []entry `json:"sessions"`
	}
	err := readSealed(a.indexPath(), &stored, indexField)
	switch {
	case err == nil:
		a.index = make(map[string]entry, len(stored.Sessions))
		for _, kept := range stored.Sessions {
			a.index[kept.ID] = kept
		}
	case errors.Is(err, os.ErrNotExist):
		a.index = make(map[string]entry)
		if err := a.rebuildLocked(); err != nil {
			return err
		}
	default:
		log.Printf("[agent] rebuilding the conversation index: %v", err)
		a.index = make(map[string]entry)
		if err := a.rebuildLocked(); err != nil {
			return err
		}
	}
	a.loaded = true
	return nil
}

// rebuildLocked builds the index from the files. A conversation that does
// not decrypt - a different secret.key, a damaged file - is left where it is
// and out of the list.
func (a *Archive) rebuildLocked() error {
	entries, err := os.ReadDir(a.directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		id, ok := strings.CutSuffix(entry.Name(), ".json")
		if !ok || !archivedID.MatchString(id) {
			continue
		}
		r, err := a.Load(id)
		if err != nil {
			log.Printf("[agent] leaving out conversation %s: %v", id, err)
			continue
		}
		a.index[id] = r.entry()
	}
	if len(a.index) == 0 {
		return nil
	}
	return a.writeIndexLocked()
}

func (a *Archive) writeIndexLocked() error {
	sessions := make([]entry, 0, len(a.index))
	for _, kept := range a.index {
		sessions = append(sessions, kept)
	}
	slices.SortFunc(sessions, func(left, right entry) int { return strings.Compare(left.ID, right.ID) })
	return writeSealed(a.indexPath(), struct {
		Version  int     `json:"version"`
		Sessions []entry `json:"sessions"`
	}{archiveVersion, sessions}, indexField)
}

func writeSealed(path string, value any, field string) error {
	plain, err := json.Marshal(value)
	if err != nil {
		return err
	}
	sealed, err := crypto.Encrypt(string(plain), field)
	if err != nil {
		return err
	}
	if err := atomicfile.Write(path, []byte(sealed)); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func readSealed(path string, into any, field string) error {
	sealed, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	// A file that is not sealed was not written here, and is not believed.
	if !crypto.IsEncrypted(string(sealed)) {
		return fmt.Errorf("%s is not encrypted", path)
	}
	plain, err := crypto.Decrypt(string(sealed), field)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(plain), into)
}
