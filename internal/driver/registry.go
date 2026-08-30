package driver

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"
)

var (
	// ErrUnknownKind means no driver is compiled in for that family.
	ErrUnknownKind = errors.New("no driver registered for this broker kind")
	// ErrNotConnected means the profile has no open connection.
	ErrNotConnected = errors.New("connection is not open")
)

// UnsupportedError reports a capability this connection does not have.
//
// Reason separates the two cases the UI must not conflate: an empty Reason
// means the family simply has no such concept, a filled one means this
// endpoint cannot do something the family generally can.
type UnsupportedError struct {
	Kind       model.MQKind
	Capability model.Capability
	Reason     string
}

func (e *UnsupportedError) Error() string {
	if e.Reason != "" {
		return fmt.Sprintf("%s does not support %s here: %s", e.Kind, e.Capability, e.Reason)
	}
	return fmt.Sprintf("%s does not support %s", e.Kind, e.Capability)
}

// Unsupported builds the error for a capability a connection lacks, carrying
// the driver's own explanation when there is one.
func Unsupported(conn Conn, capability model.Capability) error {
	reason, _ := conn.Capabilities().DegradedReason(capability)
	return &UnsupportedError{Kind: conn.Kind(), Capability: capability, Reason: reason}
}

var (
	catalogMu sync.RWMutex
	catalog   = make(map[model.MQKind]Driver)
)

// Register makes a driver available under its kind.
//
// It panics on a duplicate: registration happens from package init, so a
// duplicate is a build mistake rather than a runtime condition.
func Register(d Driver) {
	catalogMu.Lock()
	defer catalogMu.Unlock()
	kind := d.Kind()
	if _, exists := catalog[kind]; exists {
		panic(fmt.Sprintf("driver already registered for kind %q", kind))
	}
	catalog[kind] = d
}

// Lookup returns the driver for a kind.
func Lookup(kind model.MQKind) (Driver, bool) {
	catalogMu.RLock()
	defer catalogMu.RUnlock()
	d, ok := catalog[kind]
	return d, ok
}

// Registered lists the kinds a driver is compiled in for, in the order
// model.KnownKinds declares them so the UI offers them predictably.
func Registered() []model.MQKind {
	catalogMu.RLock()
	defer catalogMu.RUnlock()
	kinds := make([]model.MQKind, 0, len(catalog))
	for _, kind := range model.KnownKinds() {
		if _, ok := catalog[kind]; ok {
			kinds = append(kinds, kind)
		}
	}
	// Anything registered outside the known vocabulary still has to surface,
	// or a driver would be silently unreachable.
	for kind := range catalog {
		if !slices.Contains(kinds, kind) {
			kinds = append(kinds, kind)
		}
	}
	return kinds
}

// Registry holds open connections, keyed by connection ID.
//
// Keyed by ID rather than by endpoint address: two profiles can legitimately
// point at the same host - the same cluster under different credentials is the
// ordinary case - and an endpoint key made those one connection. Several are
// open at once, one per connection tab; activeID names the one the background
// collector samples when no caller has said which.
type Registry struct {
	mu       sync.RWMutex
	conns    map[int]Conn
	activeID int
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{conns: make(map[int]Conn)}
}

// Open dials the profile and stores the connection under its ID, replacing
// and closing whatever was open for that ID before.
func (r *Registry) Open(ctx context.Context, profile model.ConnectionProfile) error {
	d, ok := Lookup(profile.Kind)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownKind, profile.Kind)
	}
	conn, err := d.Open(ctx, profile)
	if err != nil {
		return err
	}

	r.mu.Lock()
	previous := r.conns[profile.ID]
	r.conns[profile.ID] = conn
	r.mu.Unlock()

	// Close outside the lock: a driver's Close may block on network teardown.
	if previous != nil {
		_ = previous.Close()
	}
	return nil
}

// Get returns the connection for a profile.
func (r *Registry) Get(id int) (Conn, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	conn, ok := r.conns[id]
	return conn, ok
}

// Active returns the connection the UI is currently pointed at.
func (r *Registry) Active() (Conn, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	conn, ok := r.conns[r.activeID]
	return conn, ok
}

// ActiveID returns the active profile ID, or zero when none is active.
func (r *Registry) ActiveID() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.conns[r.activeID]; !ok {
		return 0
	}
	return r.activeID
}

// SetActive points the UI at an already-open connection.
func (r *Registry) SetActive(id int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.conns[id]; !ok {
		return fmt.Errorf("%w: %d", ErrNotConnected, id)
	}
	r.activeID = id
	return nil
}

// IDs lists every open connection, so a caller that has just closed the
// active one can pick a replacement without holding the registry's lock.
func (r *Registry) IDs() []int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]int, 0, len(r.conns))
	for id := range r.conns {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}

// Close releases one connection. Closing an unknown ID is a no-op.
func (r *Registry) Close(id int) {
	r.mu.Lock()
	conn := r.conns[id]
	delete(r.conns, id)
	if r.activeID == id {
		r.activeID = 0
	}
	r.mu.Unlock()

	if conn != nil {
		_ = conn.Close()
	}
}

// CloseAll releases every connection.
func (r *Registry) CloseAll() {
	r.mu.Lock()
	conns := make([]Conn, 0, len(r.conns))
	for _, conn := range r.conns {
		conns = append(conns, conn)
	}
	r.conns = make(map[int]Conn)
	r.activeID = 0
	r.mu.Unlock()

	for _, conn := range conns {
		_ = conn.Close()
	}
}

// HasActive reports whether any connection is currently active.
//
// The background collector uses this to decide whether to sample. It must
// never dial: an absent connection means the user closed it deliberately.
func (r *Registry) HasActive() bool {
	_, ok := r.Active()
	return ok
}
