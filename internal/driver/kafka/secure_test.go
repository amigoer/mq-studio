package kafka

import (
	"context"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The cluster tests/e2e/kafka-secure brings up: one broker with SCRAM on its
 * external listener and an authorizer behind it.
 *
 * Three things need it and nothing else can reach them - what a rejected
 * credential looks like, what an ACL round trip does, and what a SCRAM user
 * is. The plain cluster answers SECURITY_DISABLED to every ACL call, which is
 * the degraded path rather than the working one.
 */
const (
	secureSeeds    = "127.0.0.1:9192"
	secureUser     = "mqstudio"
	securePassword = "mqstudio"
)

func requireSecureCluster(t *testing.T) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", secureSeeds, 2*time.Second)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("the secure kafka cluster must be running in CI: %v", err)
		}
		t.Skipf("the secure kafka cluster is not running; start it with npm run e2e:kafka:secure:up (%v)", err)
	}
	_ = conn.Close()
}

func secureConn(t *testing.T, user, password string) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, model.ConnectionProfile{
		Name:       "secure",
		Endpoints:  secureSeeds,
		TimeoutSec: 5,
		Auth:       model.AuthConfig{Mechanism: model.AuthSASLScram},
		Options:    map[string]string{OptionSCRAMSHA: "512"},
		Secrets:    map[string]string{SecretUsername: user, SecretPassword: password},
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	return opened.(*Conn)
}

// The credential half of the connection form, against a cluster that really
// checks it. The in-process fake proves the classification; this proves the
// classification is of the right thing.
func TestLiveSecureCredentials(t *testing.T) {
	requireSecureCluster(t)

	t.Run("the right credential connects", func(t *testing.T) {
		conn := secureConn(t, secureUser, securePassword)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := conn.Ping(ctx); err != nil {
			t.Fatalf("Ping: %v", err)
		}
	})

	t.Run("a wrong password reads as the credential, not the address", func(t *testing.T) {
		conn := secureConn(t, secureUser, "not-the-password")
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		err := conn.Ping(ctx)
		if err == nil {
			t.Fatal("Ping succeeded with a wrong password")
		}
		if reason := degradeReason(err, conn.authenticating); reason != credentialsRejected {
			t.Errorf("degrade reason = %q, want %q (error was %v)", reason, credentialsRejected, err)
		}
	})

	// The whole reason the SCRAM digest is a field on the form: the two are
	// separate credentials, and a user that exists under one fails under the
	// other in a way that looks exactly like a wrong password.
	t.Run("the wrong scram digest reads as the credential too", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		opened, err := New().Open(ctx, model.ConnectionProfile{
			Name: "secure-256", Endpoints: secureSeeds, TimeoutSec: 5,
			Auth:    model.AuthConfig{Mechanism: model.AuthSASLScram},
			Options: map[string]string{OptionSCRAMSHA: "256"},
			Secrets: map[string]string{SecretUsername: secureUser, SecretPassword: securePassword},
		})
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		defer func() { _ = opened.Close() }()

		conn := opened.(*Conn)
		if err := conn.Ping(ctx); err == nil {
			t.Fatal("Ping succeeded with the wrong SCRAM digest")
		} else if reason := degradeReason(err, conn.authenticating); reason != credentialsRejected {
			t.Errorf("degrade reason = %q, want %q (error was %v)", reason, credentialsRejected, err)
		}
	})

	// Anonymous against a listener that requires SASL is the address's fault
	// from the user's side: nothing there speaks what this connection speaks.
	t.Run("no credential at all is not a credential problem", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		opened, err := New().Open(ctx, model.ConnectionProfile{
			Name: "anonymous", Endpoints: secureSeeds, TimeoutSec: 2,
		})
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		defer func() { _ = opened.Close() }()

		conn := opened.(*Conn)
		if err := conn.Ping(ctx); err == nil {
			t.Fatal("an anonymous connection reached a SASL listener")
		} else if reason := degradeReason(err, conn.authenticating); reason == credentialsRejected {
			t.Errorf("a connection with no credential blamed the credential: %v", err)
		}
	})
}

// A cluster with an authorizer reports access control as available, where the
// plain one degrades it. Both are correct and the difference is the point.
func TestLiveSecureAccessControlIsAvailable(t *testing.T) {
	requireSecureCluster(t)
	conn := secureConn(t, secureUser, securePassword)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	enabled, err := conn.DirectoryEnabled(ctx)
	if err != nil {
		t.Fatalf("DirectoryEnabled: %v", err)
	}
	if !enabled {
		t.Fatal("a cluster with an authorizer reported access control as unavailable")
	}
	if reason, degraded := conn.Capabilities().DegradedReason(model.CapAccessDirectory); degraded {
		t.Errorf("access control was degraded (%s) on a cluster that has it", reason)
	}
}

func TestLiveSecureACLRoundTrip(t *testing.T) {
	requireSecureCluster(t)
	conn := secureConn(t, secureUser, securePassword)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const subject = "User:mqs-test-acl"
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveAccessRule(cleanup, subject)
	})

	if err := conn.PutAccessRule(ctx, model.AccessRule{
		Subject: subject,
		Policies: []model.AccessPolicy{
			{Resource: "topic:mqs-test-*", Actions: []string{"READ", "DESCRIBE"}, Effect: "Allow"},
			{Resource: "group:mqs-test-group", Actions: []string{"READ"}, Effect: "Allow"},
			{Resource: "topic:secrets", Actions: []string{"READ"}, Effect: "Deny",
				SourceIPs: []string{"10.0.0.1"}},
		},
	}); err != nil {
		t.Fatalf("PutAccessRule: %v", err)
	}

	rules, err := conn.ListAccessRules(ctx)
	if err != nil {
		t.Fatalf("ListAccessRules: %v", err)
	}
	var found *model.AccessRule
	for _, rule := range rules {
		if rule.Subject == subject {
			found = rule
		}
	}
	if found == nil {
		t.Fatalf("the rule that was just written is not listed: %v", rules)
	}

	resources := make(map[string]model.AccessPolicy, len(found.Policies))
	for _, policy := range found.Policies {
		resources[policy.Resource] = policy
	}

	// A prefixed pattern keeps its star: "topic:mqs-test-*" and
	// "topic:mqs-test-" are different rules and must not read the same.
	if _, ok := resources["topic:mqs-test-*"]; !ok {
		t.Errorf("the prefixed rule came back as %v", found.Policies)
	}
	if _, ok := resources["group:mqs-test-group"]; !ok {
		t.Errorf("the group rule is missing: %v", found.Policies)
	}
	denied, ok := resources["topic:secrets"]
	if !ok {
		t.Fatalf("the deny rule is missing: %v", found.Policies)
	}
	if denied.Effect != "Deny" {
		t.Errorf("the deny rule came back as %q", denied.Effect)
	}
	// A host other than * is a real narrowing and has to survive the trip.
	if len(denied.SourceIPs) != 1 || denied.SourceIPs[0] != "10.0.0.1" {
		t.Errorf("the source address came back as %v", denied.SourceIPs)
	}

	if err := conn.RemoveAccessRule(ctx, subject); err != nil {
		t.Fatalf("RemoveAccessRule: %v", err)
	}
	after, err := conn.ListAccessRules(ctx)
	if err != nil {
		t.Fatalf("ListAccessRules: %v", err)
	}
	for _, rule := range after {
		if rule.Subject == subject {
			t.Error("a deleted rule is still listed")
		}
	}
}

func TestLiveSecureSCRAMUserRoundTrip(t *testing.T) {
	requireSecureCluster(t)
	conn := secureConn(t, secureUser, securePassword)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const user = "mqs-test-scram-user"
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemovePrincipal(cleanup, user)
	})

	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
		Name: user, Secret: "a-password", Type: "SCRAM-SHA-512",
	}); err != nil {
		t.Fatalf("PutPrincipal: %v", err)
	}

	principals, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	var found *model.AccessPrincipal
	for _, principal := range principals {
		if principal.Name == user {
			found = principal
		}
	}
	if found == nil {
		t.Fatalf("the user that was just created is not listed: %v", principals)
	}
	// Which mechanisms a password exists for is the useful fact: a user with
	// only SHA-256 fails against a SHA-512 listener, and that looks exactly
	// like a wrong password.
	if !strings.Contains(found.Type, "SCRAM-SHA-512") {
		t.Errorf("mechanisms = %q, want SCRAM-SHA-512 among them", found.Type)
	}

	// A password is required. Kafka stores it salted and there is nothing to
	// ask for later, so a create with none is a request that cannot work.
	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{Name: user}); err == nil {
		t.Error("a user was created with no password")
	}

	if err := conn.RemovePrincipal(ctx, user); err != nil {
		t.Fatalf("RemovePrincipal: %v", err)
	}
	after, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	for _, principal := range after {
		if principal.Name == user {
			t.Error("a deleted user is still listed")
		}
	}
}
