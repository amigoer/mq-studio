package connection

import (
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestGetConnectionsReturnsCopies(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.AddConnection(profileOf("original", "test", "ns:9876", 5, false, "", "", "")); err != nil {
		t.Fatal(err)
	}
	list := service.GetConnections()
	list[0].Name = "mutated"
	if got := service.GetConnections()[0].Name; got != "original" {
		t.Fatalf("stored connection was mutated through returned copy: %q", got)
	}
}

func TestResolveACLCredentialsConnectionWins(t *testing.T) {
	service := newTestService(t, fakeSettings{accessKey: "global-ak", secretKey: "global-sk"})
	enabled, accessKey, secretKey := service.resolveACLCredentials(&model.ConnectionProfile{
		Auth: model.AuthConfig{Mechanism: model.AuthACL},
		Secrets: map[string]string{
			model.SecretAccessKey: "connection-ak",
			model.SecretSecretKey: "connection-sk",
		},
	})
	if !enabled || accessKey != "connection-ak" || secretKey != "connection-sk" {
		t.Fatalf("got enabled=%v accessKey=%q secretKey=%q", enabled, accessKey, secretKey)
	}
}

func TestResolveACLCredentialsNoACLNoGlobal(t *testing.T) {
	service := newTestService(t, fakeSettings{})
	enabled, accessKey, secretKey := service.resolveACLCredentials(&model.ConnectionProfile{})
	if enabled || accessKey != "" || secretKey != "" {
		t.Fatalf("expected no ACL, got enabled=%v accessKey=%q secretKey=%q", enabled, accessKey, secretKey)
	}
}

func TestResolveACLCredentialsGlobalFallback(t *testing.T) {
	service := newTestService(t, fakeSettings{accessKey: "global-ak", secretKey: "global-sk"})
	enabled, accessKey, secretKey := service.resolveACLCredentials(&model.ConnectionProfile{})
	if !enabled || accessKey != "global-ak" || secretKey != "global-sk" {
		t.Fatalf("got enabled=%v accessKey=%q secretKey=%q", enabled, accessKey, secretKey)
	}
}

func TestResolveACLCredentialsRequiresCompleteGlobalPair(t *testing.T) {
	service := newTestService(t, fakeSettings{accessKey: "global-ak"})
	enabled, accessKey, secretKey := service.resolveACLCredentials(&model.ConnectionProfile{})
	if enabled || accessKey != "" || secretKey != "" {
		t.Fatalf("incomplete global credentials must be ignored, got enabled=%v accessKey=%q secretKey=%q", enabled, accessKey, secretKey)
	}
}

func TestConnectionCRUDAndDefault(t *testing.T) {
	service := newTestService(t, fakeSettings{connectTimeout: 3 * time.Second, autoConnect: true})
	first, err := service.AddConnection(profileOf("prod", "production", "ns1:9876", 5, false, "", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == 0 || first.Name != "prod" || !first.IsDefault {
		t.Fatalf("unexpected first connection: %#v", first)
	}
	second, err := service.AddConnection(profileOf("test", "test", "ns2:9876;ns3:9876", 8, true, "ak", "sk", "note"))
	if err != nil {
		t.Fatal(err)
	}
	if !second.ACLEnabled() || second.Secret(model.SecretAccessKey) != "ak" {
		t.Fatalf("unexpected ACL connection: %#v", second)
	}

	list := service.GetConnections()
	if len(list) != 2 || list[0].ID != first.ID || list[1].ID != second.ID {
		t.Fatalf("unexpected sorted connection list: %#v", list)
	}
	list[0].Name = "hacked"
	stored, err := service.GetConnection(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Name != "prod" {
		t.Fatal("GetConnections returned mutable internal state")
	}

	updated, err := service.UpdateConnection(first.ID, profileOf("prod-2", "production", "ns1:9876", 6, false, "", "", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "prod-2" || updated.TimeoutSec != 6 {
		t.Fatalf("unexpected update: %#v", updated)
	}
	if err := service.SetDefaultConnection(second.ID); err != nil {
		t.Fatal(err)
	}
	defaultID := 0
	for _, connection := range service.GetConnections() {
		if connection.IsDefault {
			defaultID = connection.ID
		}
	}
	if defaultID != second.ID {
		t.Fatalf("default ID = %d, want %d", defaultID, second.ID)
	}
	if err := service.DeleteConnection(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.GetConnection(first.ID); err == nil {
		t.Fatal("deleted connection should not be found")
	}
}

func TestConnectionAddValidation(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.AddConnection(profileOf("", "test", "ns:9876", 5, false, "", "", "")); err == nil {
		t.Fatal("empty name should fail")
	}
	if _, err := service.AddConnection(profileOf("x", "test", "", 5, false, "", "", "")); err == nil {
		t.Fatal("empty NameServer should fail")
	}
	if _, err := service.AddConnection(profileOf("x", "test", "ns:9876", 5, true, "", "sk", "")); err == nil {
		t.Fatal("ACL without AccessKey should fail")
	}
}

func TestConnectionPersistReload(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.AddConnection(profileOf("keep", "development", "127.0.0.1:9876", 5, true, "ak1", "sk1", "")); err != nil {
		t.Fatal(err)
	}
	reloaded := New(service.dataFilePath, fakeSettings{connectTimeout: 3 * time.Second, autoConnect: true}, noopRuntime{})
	list := reloaded.GetConnections()
	if len(list) != 1 || list[0].Secret(model.SecretAccessKey) != "ak1" || list[0].Secret(model.SecretSecretKey) != "sk1" {
		t.Fatalf("reloaded credentials do not match: %#v", list)
	}
}
