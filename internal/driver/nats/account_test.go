package nats

import (
	"encoding/json"
	"errors"
	"math"
	"testing"

	natsclient "github.com/nats-io/nats.go"

	"github.com/amigoer/mq-studio/internal/model"
)

// accountNamed finds one row, or fails saying what was listed instead.
func accountNamed(t *testing.T, accounts []*model.Namespace, name string) *model.Namespace {
	t.Helper()
	listed := make([]string, 0, len(accounts))
	for _, account := range accounts {
		if account.Name == name {
			return account
		}
		listed = append(listed, account.Name)
	}
	t.Fatalf("no account named %q; listed %v", name, listed)
	return nil
}

func TestAccountsAreListedWithTheSystemOneMarked(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	app := accountNamed(t, accounts, "APP")
	if app.Attributes[AttrIsSystemAccount] != "" {
		t.Error("APP is marked as the system account")
	}
	// The system account is the one $SYS.REQ.* answers on, and an operator
	// looking at a list of names has no other way to tell which it is.
	system := accountNamed(t, accounts, "SYS")
	if system.Attributes[AttrIsSystemAccount] != "true" {
		t.Error("SYS is not marked as the system account")
	}
}

func TestAccountsAreListedThroughTheMonitoringEndpointAlone(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true,
	})
	conn := open(t, fake, true, false)

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	app := accountNamed(t, accounts, "APP")
	if app.Attributes[AttrSource] != SourceMonitor {
		t.Errorf("read via %q, want %q", app.Attributes[AttrSource], SourceMonitor)
	}
	// One server answered, whatever the size of the cluster. The row says so
	// because the figures on it are that server's share rather than the
	// cluster's total, and a page that did not say would be quietly wrong on
	// every clustered deployment.
	if app.Attributes[AttrServersReporting] != "1" {
		t.Errorf("servers reporting = %q, want 1", app.Attributes[AttrServersReporting])
	}
}

func TestAnAccountReportsWhatItIsCarrying(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	other := spare(t, fake, "an-application")
	if _, err := other.Subscribe("orders.>", func(*natsclient.Msg) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	if err := other.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	app := accountNamed(t, accounts, "APP")
	if app.Attributes[AttrConnections] == "" || app.Attributes[AttrConnections] == "0" {
		t.Errorf("connections = %q, want the two clients this test opened",
			app.Attributes[AttrConnections])
	}
	if app.Attributes[AttrSubscriptions] == "" || app.Attributes[AttrSubscriptions] == "0" {
		t.Errorf("subscriptions = %q, want the one this test made",
			app.Attributes[AttrSubscriptions])
	}
}

// An account with no JetStream is a fact rather than an account whose figures
// failed to load, and the page draws the two differently.
func TestAnAccountWithoutJetStreamSaysSoRatherThanReportingZero(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	if got := accountNamed(t, accounts, "APP").Attributes[AttrAccountJetStream]; got != "true" {
		t.Errorf("APP jetstream = %q, want true", got)
	}
	system := accountNamed(t, accounts, "SYS")
	if got := system.Attributes[AttrAccountJetStream]; got != "" {
		t.Errorf("SYS jetstream = %q, want nothing - the account does not have it", got)
	}
	if _, capped := system.Limits[LimitStorage]; capped {
		t.Error("SYS reports a JetStream storage limit and has no JetStream")
	}
}

// The limit an account was configured with, read back off a real server.
// reservation() is unit-tested below; this is what pins the JSON path to it.
func TestACappedAccountReportsTheCapItWasGiven(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, jetStreamLimit: true,
		monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	app := accountNamed(t, accounts, "APP")
	if app.Limits[LimitMemory] != fakeMemoryLimit {
		t.Errorf("memory limit = %d, want %d", app.Limits[LimitMemory], fakeMemoryLimit)
	}
	if app.Limits[LimitStorage] != fakeStoreLimit {
		t.Errorf("storage limit = %d, want %d", app.Limits[LimitStorage], fakeStoreLimit)
	}
}

// The same account granted JetStream with no cap. Sixteen exabytes is what an
// uncapped reservation looks like on the wire, and reporting it as a limit
// would draw a meter that can never move.
func TestAnUncappedAccountReportsNoLimitAtAll(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	accounts, err := conn.ListNamespaces(testContext(t))
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	app := accountNamed(t, accounts, "APP")
	if limit, capped := app.Limits[LimitStorage]; capped {
		t.Errorf("storage limit = %d, want none - the account is uncapped", limit)
	}
	if limit, capped := app.Limits[LimitMemory]; capped {
		t.Errorf("memory limit = %d, want none - the account is uncapped", limit)
	}
}

func TestReservationTellsUncappedFromCapped(t *testing.T) {
	for _, tc := range []struct {
		name     string
		reserved uint64
		want     int
		capped   bool
	}{
		// int64(-1) published as uint64. The server holds no-cap as a
		// negative number and the document is unsigned, so this is what
		// arrives rather than anything that looks like an absence.
		{"uncapped", math.MaxUint64, 0, false},
		// A real cap of zero: an account granted JetStream and no allowance
		// in it. Different from uncapped, and the model has room for both.
		{"none allowed", 0, 0, true},
		{"capped", 8 << 20, 8 << 20, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			limit, capped := reservation(tc.reserved)
			if capped != tc.capped || limit != tc.want {
				t.Errorf("reservation(%d) = %d, %v; want %d, %v",
					tc.reserved, limit, capped, tc.want, tc.capped)
			}
		})
	}
}

/*
 * The roster is the union of what the servers said, not the first answer.
 *
 * Accounts are configuration, so a healthy cluster agrees. A server restarted
 * with a stale file does not, and taking one server's word for it would hide
 * exactly the discrepancy this page is opened to find.
 */
func TestTheRosterKeepsAnAccountOnlyOneServerKnows(t *testing.T) {
	reply := func(system string, accounts ...string) systemReply {
		body, err := json.Marshal(accountzResponse{SystemAccount: system, Accounts: accounts})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return systemReply{Data: body}
	}

	roster, err := rosterFromReplies([]systemReply{
		reply("SYS", "$G", "APP", "SYS"),
		reply("SYS", "$G", "APP", "SYS", "LEGACY"),
	})
	if err != nil {
		t.Fatalf("rosterFromReplies: %v", err)
	}
	if len(roster.names) != 4 {
		t.Errorf("roster = %v, want each account once", roster.names)
	}
	if roster.servers != 2 {
		t.Errorf("servers = %d, want 2", roster.servers)
	}
	if roster.system != "SYS" {
		t.Errorf("system account = %q, want SYS", roster.system)
	}
	if !roster.isSystem("SYS") || roster.isSystem("APP") {
		t.Error("the system account is not the one marked")
	}
}

// A roster read before the system account is known must not mark every
// account as the system one, which is what an empty name compared for
// equality would do.
func TestNoAccountIsTheSystemOneWhenNoneWasNamed(t *testing.T) {
	roster := accountRoster{names: []string{"APP"}}
	if roster.isSystem("") || roster.isSystem("APP") {
		t.Error("an unnamed system account matched")
	}
}

// Message counts are unknown rather than zero. NATS has no account-wide total
// - JetStream counts bytes per account and messages per stream - and a zero
// would read as an account holding nothing.
func TestAnAccountReportsNoMessageCountRatherThanZero(t *testing.T) {
	account := namespaceOf("APP", accountRoster{source: SourceMonitor, servers: 1}, nil, jszAccount{})
	if account.Messages != model.UnknownMetric ||
		account.Ready != model.UnknownMetric ||
		account.Unacknowledged != model.UnknownMetric {
		t.Errorf("messages = %d/%d/%d, want all unknown",
			account.Messages, account.Ready, account.Unacknowledged)
	}
}

// Accounts are read-only, and the error says where they do come from. Nothing
// in the app calls these - the capability is never declared - but the two
// methods are on the interface that carries the listing, so they have to
// answer something.
func TestAnAccountCannotBeCreatedOverAConnection(t *testing.T) {
	conn := &Conn{}
	if err := conn.CreateNamespace(testContext(t), model.NamespaceSpec{Name: "NEW"}); err == nil {
		t.Error("creating an account was accepted")
	} else if !errors.Is(err, errAccountsAreConfiguration) {
		t.Errorf("create said %q, want the configuration explanation", err)
	}
	if err := conn.RemoveNamespace(testContext(t), "APP"); !errors.Is(err, errAccountsAreConfiguration) {
		t.Errorf("remove said %v, want the configuration explanation", err)
	}
}

// Neither cluster tier means no listing, reported as the degraded reason the
// sidebar shows rather than as a request that failed.
func TestListingAccountsNeedsOneOfTheTwoClusterTiers(t *testing.T) {
	fake := startServer(t, serverOptions{jetStream: true, jetStreamAccount: true})
	conn := open(t, fake, false, false)

	_, err := conn.ListNamespaces(testContext(t))
	var unsupported *driverUnsupported
	if !errors.As(err, &unsupported) {
		t.Fatalf("ListNamespaces said %v, want an unsupported reason", err)
	}
	if unsupported.reason != systemAbsent {
		t.Errorf("reason = %q, want %q", unsupported.reason, systemAbsent)
	}
}
