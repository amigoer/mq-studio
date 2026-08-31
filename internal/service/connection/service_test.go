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

/*
 * The bug: only RocketMQ's access key pair survived a save.
 *
 * Every other family's credentials were dropped on the way to disk, and the
 * auth mechanism was forced to "none" with them. A RabbitMQ connection was
 * therefore stored as anonymous with no username and no password, and could
 * not open. The form's test button hid it: it probes the submitted profile
 * rather than the stored one, so it passed on the way in.
 */
func TestAddKeepsEveryDriverSecret(t *testing.T) {
	service := newTestService(t, nil)
	input := model.ConnectionProfile{
		Name:       "RabbitMQ",
		Kind:       model.KindRabbitMQ,
		Endpoints:  "http://127.0.0.1:15672",
		TimeoutSec: 5,
		Auth:       model.AuthConfig{Mechanism: model.AuthPlain},
	}
	input.SetSecret("username", "app")
	input.SetSecret("password", "s3cret")

	added, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := service.GetConnection(added.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Secret("username") != "app" || stored.Secret("password") != "s3cret" {
		t.Errorf("stored username=%q password=%q, want both",
			stored.Secret("username"), stored.Secret("password"))
	}
	// A family with its own mechanism must not be filed as anonymous.
	if stored.Auth.Mechanism != model.AuthPlain {
		t.Errorf("mechanism = %q, want %q", stored.Auth.Mechanism, model.AuthPlain)
	}
}

// And they have to survive the round trip through the file, which is where
// they are encrypted.
func TestDriverSecretsSurviveAReload(t *testing.T) {
	service := newTestService(t, nil)
	input := model.ConnectionProfile{
		Name: "RabbitMQ", Kind: model.KindRabbitMQ,
		Endpoints: "http://127.0.0.1:15672", TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	input.SetSecret("username", "app")
	input.SetSecret("password", "s3cret")
	added, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}

	reopened := New(service.dataFilePath, fakeSettings{}, noopRuntime{})
	stored, err := reopened.GetConnection(added.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Secret("password") != "s3cret" {
		t.Errorf("password after reload = %q", stored.Secret("password"))
	}
	if stored.Auth.Mechanism != model.AuthPlain {
		t.Errorf("mechanism after reload = %q", stored.Auth.Mechanism)
	}
}

// Editing has the same hole, and a password nobody can change is as bad as one
// nobody can set.
func TestUpdateReplacesADriverSecret(t *testing.T) {
	service := newTestService(t, nil)
	input := model.ConnectionProfile{
		Name: "RabbitMQ", Kind: model.KindRabbitMQ,
		Endpoints: "http://127.0.0.1:15672", TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	input.SetSecret("username", "app")
	input.SetSecret("password", "old")
	added, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}

	input.SetSecret("password", "new")
	if _, err := service.UpdateConnection(added.ID, input); err != nil {
		t.Fatal(err)
	}
	stored, err := service.GetConnection(added.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Secret("password") != "new" {
		t.Errorf("password = %q, want the new one", stored.Secret("password"))
	}
}

/*
 * RocketMQ's path is untouched. Turning ACL off still clears the pair and
 * files the connection as anonymous, which is what "no ACL" means for the one
 * family whose only mechanism is ACL.
 */
func TestDisablingACLStillClearsTheRocketMQPair(t *testing.T) {
	service := newTestService(t, nil)
	withACL := profileOf("rmq", "test", "ns:9876", 5, true, "ak", "sk", "")
	added, err := service.AddConnection(withACL)
	if err != nil {
		t.Fatal(err)
	}
	if added.Secret(model.SecretAccessKey) != "ak" || added.Auth.Mechanism != model.AuthACL {
		t.Fatalf("ACL was not stored: %+v", added.Auth)
	}

	without := profileOf("rmq", "test", "ns:9876", 5, false, "", "", "")
	updated, err := service.UpdateConnection(added.ID, without)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Secret(model.SecretAccessKey) != "" || updated.Secret(model.SecretSecretKey) != "" {
		t.Error("the access key pair survived ACL being turned off")
	}
	if updated.Auth.Mechanism != model.AuthNone {
		t.Errorf("mechanism = %q, want none", updated.Auth.Mechanism)
	}
}

/*
 * A changed credential has to drop the open client. It used to compare only
 * the access key pair, so a new RabbitMQ password left the old connection
 * running until the app restarted.
 */
func TestChangingADriverSecretForcesAReconnect(t *testing.T) {
	service := newTestService(t, nil)

	input := model.ConnectionProfile{
		Name: "RabbitMQ", Kind: model.KindRabbitMQ,
		Endpoints: "http://127.0.0.1:15672", TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	input.SetSecret("username", "app")
	input.SetSecret("password", "old")
	added, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}

	input.SetSecret("password", "new")
	updated, err := service.UpdateConnection(added.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != model.StatusOffline {
		t.Errorf("status = %q, want offline so the next read redials", updated.Status)
	}
}

func TestSameSecretsComparesBothWays(t *testing.T) {
	if !sameSecrets(map[string]string{"a": "1"}, map[string]string{"a": "1"}) {
		t.Error("identical sets compared unequal")
	}
	if sameSecrets(map[string]string{"a": "1"}, map[string]string{"a": "2"}) {
		t.Error("a changed value compared equal")
	}
	// A key added on one side only, in each direction.
	if sameSecrets(map[string]string{"a": "1"}, map[string]string{"a": "1", "b": "2"}) {
		t.Error("an added key compared equal")
	}
	if sameSecrets(map[string]string{"a": "1", "b": "2"}, map[string]string{"a": "1"}) {
		t.Error("a removed key compared equal")
	}
}
