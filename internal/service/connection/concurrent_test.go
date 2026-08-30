package connection

import (
	"sync"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// recordingRuntime keeps one client per profile id, which is all the id-keyed
// ClientRuntime contract promises.
type recordingRuntime struct {
	mu      sync.Mutex
	clients map[int]string
	tested  []int
}

func newRecordingRuntime() *recordingRuntime {
	return &recordingRuntime{clients: make(map[int]string)}
}

func (r *recordingRuntime) Connect(profile model.ConnectionProfile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients[profile.ID] = profile.Endpoints
	return nil
}

func (r *recordingRuntime) HasClient(id int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.clients[id]
	return ok
}

func (r *recordingRuntime) Remove(id int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, id)
}

func (r *recordingRuntime) Test(profile model.ConnectionProfile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tested = append(r.tested, profile.ID)
	return nil
}

func (r *recordingRuntime) CloseAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients = make(map[int]string)
}

func (r *recordingRuntime) openIDs() []int {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := make([]int, 0, len(r.clients))
	for id := range r.clients {
		ids = append(ids, id)
	}
	return ids
}

// Connecting one profile used to close every other client and mark every other
// profile offline. The shell opens a tab per connection and reads each tab's
// pages by connection id, so an eviction here showed one cluster's data under
// another cluster's tab.
func TestConnectKeepsEarlierConnectionsOpen(t *testing.T) {
	service := newTestService(t, nil)
	runtime := newRecordingRuntime()
	service.runtime = runtime

	first, err := service.AddConnection(profileOf("first", "", "first:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.AddConnection(profileOf("second", "", "second:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}

	if err := service.Connect(first.ID); err != nil {
		t.Fatalf("connect first: %v", err)
	}
	if err := service.Connect(second.ID); err != nil {
		t.Fatalf("connect second: %v", err)
	}

	if got := len(runtime.openIDs()); got != 2 {
		t.Fatalf("open clients = %d (%v), want both connections open", got, runtime.openIDs())
	}
	for _, profile := range service.GetConnections() {
		if profile.Status != model.StatusOnline {
			t.Fatalf("connection %d status = %q, want online", profile.ID, profile.Status)
		}
	}
}

// Disconnecting one connection must not disturb the others, and must not move
// the default flag: default names what reconnects on launch, and closing a tab
// says nothing about that.
func TestDisconnectLeavesOtherConnectionsAndDefaultAlone(t *testing.T) {
	service := newTestService(t, nil)
	runtime := newRecordingRuntime()
	service.runtime = runtime

	first, err := service.AddConnection(profileOf("first", "", "first:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.AddConnection(profileOf("second", "", "second:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(first.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(second.ID); err != nil {
		t.Fatal(err)
	}

	if err := service.Disconnect(first.ID); err != nil {
		t.Fatalf("disconnect: %v", err)
	}

	if runtime.HasClient(first.ID) {
		t.Fatal("disconnected connection kept its client")
	}
	if !runtime.HasClient(second.ID) {
		t.Fatal("disconnecting one connection closed another")
	}

	profiles := map[int]*model.ConnectionProfile{}
	for _, profile := range service.GetConnections() {
		profiles[profile.ID] = profile
	}
	if profiles[first.ID].Status != model.StatusOffline {
		t.Fatalf("first status = %q, want offline", profiles[first.ID].Status)
	}
	if profiles[second.ID].Status != model.StatusOnline {
		t.Fatalf("second status = %q, want online", profiles[second.ID].Status)
	}
	// AddConnection made the first profile default; disconnecting it is not a
	// reason to promote another.
	if !profiles[first.ID].IsDefault || profiles[second.ID].IsDefault {
		t.Fatalf("default moved on disconnect: first=%v second=%v",
			profiles[first.ID].IsDefault, profiles[second.ID].IsDefault)
	}
}

// The runtime dials what the profile carries, so the service has to resolve
// the settings fallbacks before handing it over - otherwise a driver would
// need to read application settings to know its own credentials.
func TestRuntimeReceivesResolvedTimeoutAndCredentials(t *testing.T) {
	service := newTestService(t, fakeSettings{
		connectTimeout: 11 * time.Second,
		autoConnect:    true,
		accessKey:      "global-ak",
		secretKey:      "global-sk",
	})
	var resolved model.ConnectionProfile
	runtime := newRecordingRuntime()
	service.runtime = &capturingRuntime{recordingRuntime: runtime, seen: &resolved}

	// The profile carries a timeout but no ACL, so only the credentials fall
	// back to settings.
	profile, err := service.AddConnection(profileOf("p", "", "ns:9876", 9, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(profile.ID); err != nil {
		t.Fatal(err)
	}

	if resolved.TimeoutSec != 9 {
		t.Fatalf("resolved TimeoutSec = %d, want the profile's own timeout", resolved.TimeoutSec)
	}
	if !resolved.ACLEnabled() {
		t.Fatal("global ACL credentials did not reach the runtime")
	}
	if resolved.Secret(model.SecretAccessKey) != "global-ak" ||
		resolved.Secret(model.SecretSecretKey) != "global-sk" {
		t.Fatalf("resolved credentials = %q/%q", resolved.Secret(model.SecretAccessKey),
			resolved.Secret(model.SecretSecretKey))
	}
	// The stored profile keeps its own shape: resolution is for dialling only.
	stored, err := service.GetConnection(profile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ACLEnabled() {
		t.Fatalf("resolution leaked into the stored profile: %#v", stored)
	}
}

type capturingRuntime struct {
	*recordingRuntime
	seen *model.ConnectionProfile
}

func (c *capturingRuntime) Connect(profile model.ConnectionProfile) error {
	*c.seen = profile
	return c.recordingRuntime.Connect(profile)
}

// A profile with no timeout of its own takes the application setting.
//
// It used to take nothing: every stored profile was stamped with a positive
// default on the way in, so `TimeoutSec > 0` was always true and the settings
// page's 连接超时 reached no connection at all.
func TestBlankProfileTimeoutTakesTheApplicationSetting(t *testing.T) {
	service := newTestService(t, fakeSettings{
		connectTimeout: 11 * time.Second,
		autoConnect:    true,
	})
	var resolved model.ConnectionProfile
	runtime := newRecordingRuntime()
	service.runtime = &capturingRuntime{recordingRuntime: runtime, seen: &resolved}

	profile, err := service.AddConnection(profileOf("p", "", "ns:9876", 0, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(profile.ID); err != nil {
		t.Fatal(err)
	}

	if resolved.TimeoutSec != 11 {
		t.Fatalf("resolved TimeoutSec = %d, want the application setting", resolved.TimeoutSec)
	}
	// The blank has to survive storage, or the next dial shadows the setting again.
	stored, err := service.GetConnection(profile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.TimeoutSec != 0 {
		t.Fatalf("stored TimeoutSec = %d, want the blank to survive", stored.TimeoutSec)
	}
}
