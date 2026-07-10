package service

import (
	"path/filepath"
	"testing"

	"rocket-leaf/internal/model"
)

func newTestConnectionService(t *testing.T, ss *SettingsService) *ConnectionService {
	t.Helper()
	ensureTestCrypto(t)
	return &ConnectionService{
		connections:     make(map[int]*model.Connection),
		nextID:          1,
		dataFilePath:    filepath.Join(t.TempDir(), "connections.json"),
		settingsService: ss,
	}
}

func TestConnectionCRUDAndDefault(t *testing.T) {
	ss := newTestSettingsService(t)
	s := newTestConnectionService(t, ss)

	c1, err := s.AddConnection("prod", string(model.EnvProduction), "ns1:9876", 5, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if c1.ID == 0 || c1.Name != "prod" {
		t.Fatalf("add: %#v", c1)
	}

	c2, err := s.AddConnection("test", string(model.EnvTest), "ns2:9876;ns3:9876", 8, true, "ak", "sk", "note")
	if err != nil {
		t.Fatal(err)
	}
	if !c2.EnableACL || c2.AccessKey != "ak" {
		t.Fatalf("acl add: %#v", c2)
	}

	list := s.GetConnections()
	if len(list) != 2 {
		t.Fatalf("list len %d", len(list))
	}

	// Mutating returned copy must not affect store.
	list[0].Name = "hacked"
	got, err := s.GetConnection(c1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "prod" {
		t.Fatal("internal state mutated via GetConnection copy")
	}

	updated, err := s.UpdateConnection(c1.ID, "prod-2", string(model.EnvProduction), "ns1:9876", 6, false, "", "", "x")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "prod-2" || updated.TimeoutSec != 6 {
		t.Fatalf("update: %#v", updated)
	}

	if err := s.SetDefaultConnection(c2.ID); err != nil {
		t.Fatal(err)
	}
	var defID int
	for _, c := range s.GetConnections() {
		if c.IsDefault {
			defID = c.ID
		}
	}
	if defID != c2.ID {
		t.Fatalf("default id = %d, want %d", defID, c2.ID)
	}

	if err := s.DeleteConnection(c1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetConnection(c1.ID); err == nil {
		t.Fatal("deleted connection should be gone")
	}
}

func TestConnectionAddValidation(t *testing.T) {
	s := newTestConnectionService(t, newTestSettingsService(t))
	if _, err := s.AddConnection("", string(model.EnvTest), "ns:9876", 5, false, "", "", ""); err == nil {
		t.Fatal("empty name")
	}
	if _, err := s.AddConnection("x", string(model.EnvTest), "", 5, false, "", "", ""); err == nil {
		t.Fatal("empty ns")
	}
	if _, err := s.AddConnection("x", string(model.EnvTest), "ns:9876", 5, true, "", "sk", ""); err == nil {
		t.Fatal("acl without ak")
	}
}

func TestConnectionPersistReload(t *testing.T) {
	ss := newTestSettingsService(t)
	s := newTestConnectionService(t, ss)
	path := s.dataFilePath
	if _, err := s.AddConnection("keep", string(model.EnvDevelopment), "127.0.0.1:9876", 5, true, "ak1", "sk1", ""); err != nil {
		t.Fatal(err)
	}

	reloaded := &ConnectionService{
		connections:     make(map[int]*model.Connection),
		nextID:          1,
		dataFilePath:    path,
		settingsService: ss,
	}
	if err := reloaded.loadConnectionsFromFile(); err != nil {
		t.Fatal(err)
	}
	list := reloaded.GetConnections()
	if len(list) != 1 || list[0].AccessKey != "ak1" || list[0].SecretKey != "sk1" {
		t.Fatalf("reload decrypt failed: %#v", list)
	}
}
