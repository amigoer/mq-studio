package connection

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// windowAndReader is two processes over one store: the window, which owns the
// file, and a reader that may only refresh from it - the MCP server's shape.
func windowAndReader(t *testing.T, settings Settings) (*Service, *Service, *recordingRuntime) {
	t.Helper()
	ensureTestCrypto(t)
	path := filepath.Join(t.TempDir(), "connections.json")
	window := New(path, fakeSettings{connectTimeout: 3 * time.Second}, noopRuntime{}, addressedEndpoints{})
	runtime := newRecordingRuntime()
	reader := New(path, settings, runtime, addressedEndpoints{})
	return window, reader, runtime
}

// openInReader dials a connection the window stored, as the reader would on
// first being asked for it.
func openInReader(t *testing.T, reader *Service, id int) {
	t.Helper()
	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if err := reader.OpenReadOnly(id); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRefreshSeesAConnectionAddedAfterStart(t *testing.T) {
	window, reader, _ := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})

	added, err := window.AddConnection(profileOf("later", "", "later:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.GetConnection(added.ID); err == nil {
		t.Fatal("the reader knew the connection before refreshing, so this proves nothing")
	}

	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.GetConnection(added.ID); err != nil {
		t.Fatalf("a connection added in the window is unknown after a refresh: %v", err)
	}
}

func TestRefreshRedialsAConnectionEditedInTheWindow(t *testing.T) {
	window, reader, runtime := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})
	added, err := window.AddConnection(profileOf("p", "", "old:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	openInReader(t, reader, added.ID)

	if _, err := window.UpdateConnection(added.ID, profileOf("p", "", "new:9876", 5, false, "", "", "")); err != nil {
		t.Fatal(err)
	}
	written := readFile(t, reader.dataFilePath)

	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if runtime.HasClient(added.ID) {
		t.Fatal("the client dialled with the old endpoints survived the edit")
	}
	if err := reader.OpenReadOnly(added.ID); err != nil {
		t.Fatal(err)
	}
	if got := runtime.clients[added.ID]; got != "new:9876" {
		t.Fatalf("redialled %q, want the edited endpoints", got)
	}
	if !bytes.Equal(readFile(t, reader.dataFilePath), written) {
		t.Fatal("the reader wrote the store the window owns")
	}
}

// The window rewrites the store every time it connects anything, and a label
// is not a dial parameter. Dropping a working client for either would make
// every agent call on it pay a redial while the user merely used the window.
func TestRefreshKeepsAClientTheWindowOnlyStampedOrRenamed(t *testing.T) {
	window, reader, runtime := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})
	added, err := window.AddConnection(profileOf("p", "", "ns:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	openInReader(t, reader, added.ID)

	before := readFile(t, reader.dataFilePath)
	if err := window.Connect(added.ID); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(before, readFile(t, reader.dataFilePath)) {
		t.Fatal("connecting in the window did not rewrite the store, so this proves nothing")
	}
	if _, err := window.UpdateConnection(added.ID, profileOf("renamed", "prod", "ns:9876", 5, false, "", "", "")); err != nil {
		t.Fatal(err)
	}

	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if !runtime.HasClient(added.ID) {
		t.Fatal("a status stamp and a rename dropped a client whose dial had not changed")
	}
	stored, err := reader.GetConnection(added.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Name != "renamed" {
		t.Fatalf("name = %q, want the window's rename", stored.Name)
	}
}

func TestRefreshForgetsAConnectionDeletedInTheWindow(t *testing.T) {
	window, reader, runtime := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})
	added, err := window.AddConnection(profileOf("p", "", "ns:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	openInReader(t, reader, added.ID)

	if err := window.DeleteConnection(added.ID); err != nil {
		t.Fatal(err)
	}
	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if runtime.HasClient(added.ID) {
		t.Fatal("a deleted connection is still open")
	}
	if _, err := reader.GetConnection(added.ID); err == nil {
		t.Fatal("a deleted connection is still listed")
	}
}

// The store is unchanged here, which is the point: a profile that leans on the
// global credentials is dialled differently when only the settings moved.
func TestRefreshRedialsWhenTheGlobalCredentialsChanged(t *testing.T) {
	window, reader, runtime := windowAndReader(t, fakeSettings{
		connectTimeout: 3 * time.Second, accessKey: "old-ak", secretKey: "old-sk"})
	added, err := window.AddConnection(profileOf("p", "", "ns:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	openInReader(t, reader, added.ID)

	reader.settings = fakeSettings{connectTimeout: 3 * time.Second, accessKey: "new-ak", secretKey: "new-sk"}
	if err := reader.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}
	if runtime.HasClient(added.ID) {
		t.Fatal("the client dialled with the old global credentials survived")
	}
}

// An empty list reads as "no connections", which is a different answer from
// "the list could not be read".
func TestRefreshKeepsTheLastGoodProfilesWhenTheStoreIsUnreadable(t *testing.T) {
	window, reader, runtime := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})
	added, err := window.AddConnection(profileOf("p", "", "ns:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	openInReader(t, reader, added.ID)

	if err := os.WriteFile(reader.dataFilePath, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := reader.RefreshReadOnly(); err == nil {
		t.Fatal("an unreadable store refreshed without complaint")
	}
	if _, err := reader.GetConnection(added.ID); err != nil {
		t.Fatalf("an unreadable store emptied the profiles: %v", err)
	}
	if !runtime.HasClient(added.ID) {
		t.Fatal("an unreadable store closed a client it had no new profile for")
	}
}

type countingRuntime struct {
	*recordingRuntime
	dials int
}

func (c *countingRuntime) Connect(profile model.ConnectionProfile) error {
	c.dials++
	return c.recordingRuntime.Connect(profile)
}

func TestOpenReadOnlyKeepsAClientAlreadyOpen(t *testing.T) {
	window, reader, _ := windowAndReader(t, fakeSettings{connectTimeout: 3 * time.Second})
	runtime := &countingRuntime{recordingRuntime: newRecordingRuntime()}
	reader.runtime = runtime
	added, err := window.AddConnection(profileOf("p", "", "ns:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}

	openInReader(t, reader, added.ID)
	if err := reader.OpenReadOnly(added.ID); err != nil {
		t.Fatal(err)
	}
	if runtime.dials != 1 {
		t.Fatalf("dialled %d times, want the open client kept", runtime.dials)
	}
}
