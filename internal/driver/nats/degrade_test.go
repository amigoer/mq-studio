package nats

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
)

// open dials the fixture and returns the connection, closed when the test ends.
func open(t *testing.T, fake *fakeServer, withMonitor, withSystem bool) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, fake.profile(withMonitor, withSystem))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	return conn
}

// The probe has to say which tier is missing, not that something is.
//
// Each of these sends an operator somewhere different: to how the server was
// started, to how the account was written, to the connection form, or to the
// credentials they were given. A single reason covering two of them would send
// half the readers to the wrong file, which is the whole reason the constants
// are split this finely.
func TestProbeNamesWhichTierIsMissing(t *testing.T) {
	cases := []struct {
		name        string
		options     serverOptions
		withMonitor bool
		withSystem  bool

		wantJetStream bool
		wantJSReason  string
		wantMonitor   bool
		wantMonReason string
		wantSystem    bool
		wantSysReason string
	}{
		{
			name:          "everything answers",
			options:       serverOptions{jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true},
			withMonitor:   true,
			withSystem:    true,
			wantJetStream: true,
			wantMonitor:   true,
			wantSystem:    true,
		},
		{
			name:         "a server built without jetstream",
			options:      serverOptions{monitor: true, systemAccount: true},
			withMonitor:  true,
			withSystem:   true,
			wantJSReason: jetStreamDisabled,
			wantMonitor:  true,
			wantSystem:   true,
		},
		{
			// The subsystem is running and this account may not use it. The
			// fix is in the account, not in how the server was started, so it
			// must not arrive as the reason above.
			name:         "an account jetstream was withheld from",
			options:      serverOptions{jetStream: true, monitor: true, systemAccount: true},
			withMonitor:  true,
			withSystem:   true,
			wantJSReason: jetStreamNoAccount,
			wantMonitor:  true,
			wantSystem:   true,
		},
		{
			// Nobody said where the endpoint is. The server may well be
			// serving one.
			name:          "no monitoring address on the form",
			options:       serverOptions{jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true},
			withSystem:    true,
			wantJetStream: true,
			wantMonReason: monitorAbsent,
			wantSystem:    true,
		},
		{
			// An address was given and the server is not serving it. That is
			// a working configuration somebody has to repair, which is not
			// the same as one they chose not to write.
			name:          "a monitoring address that does not answer",
			options:       serverOptions{jetStream: true, jetStreamAccount: true, systemAccount: true},
			withMonitor:   true,
			withSystem:    true,
			wantJetStream: true,
			wantMonReason: monitorUnreachable,
			wantSystem:    true,
		},
		{
			name:          "no system credentials on the form",
			options:       serverOptions{jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true},
			withMonitor:   true,
			wantJetStream: true,
			wantMonitor:   true,
			wantSysReason: systemAbsent,
		},
		{
			// Credentials were given and there is no system account to accept
			// them. An operator handed the reason above would go and fill in
			// a form that is already filled in.
			name:          "system credentials the server will not take",
			options:       serverOptions{jetStream: true, jetStreamAccount: true, monitor: true},
			withMonitor:   true,
			withSystem:    true,
			wantJetStream: true,
			wantMonitor:   true,
			wantSysReason: systemForbidden,
		},
		{
			name:          "core nats and nothing else",
			options:       serverOptions{},
			wantJSReason:  jetStreamDisabled,
			wantMonReason: monitorAbsent,
			wantSysReason: systemAbsent,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			fake := startServer(t, test.options)
			// A monitoring address the server is not serving has to point
			// somewhere that refuses rather than somewhere that hangs, or the
			// test measures the dial timeout instead of the probe.
			conn := openWithMonitor(t, fake, test.withMonitor, test.withSystem)

			assertTier(t, "jetstream", conn.tiers.jetStream, conn.tiers.jetStreamReason, test.wantJetStream, test.wantJSReason)
			assertTier(t, "monitor", conn.tiers.monitor, conn.tiers.monitorReason, test.wantMonitor, test.wantMonReason)
			assertTier(t, "system", conn.tiers.system, conn.tiers.systemReason, test.wantSystem, test.wantSysReason)
		})
	}
}

// openWithMonitor dials, substituting a closed port when the test asked for a
// monitoring address against a server that is not serving one.
func openWithMonitor(t *testing.T, fake *fakeServer, withMonitor, withSystem bool) *Conn {
	t.Helper()
	if withMonitor && fake.monitorURL == "" {
		fake.monitorURL = "http://127.0.0.1:1"
	}
	return open(t, fake, withMonitor, withSystem)
}

func assertTier(t *testing.T, tier string, got bool, gotReason string, want bool, wantReason string) {
	t.Helper()
	if got != want {
		t.Errorf("%s tier available = %v, want %v (reason %q)", tier, got, want, gotReason)
	}
	if gotReason != wantReason {
		t.Errorf("%s tier reason = %q, want %q", tier, gotReason, wantReason)
	}
}

// A reason reaches the renderer as a key and is turned into a sentence there.
// One written as English prose would put that prose on screen in every
// language, which is what happened to MQTT.
func TestDegradeReasonsAreTranslationKeys(t *testing.T) {
	reasons := map[string]string{
		"jetStreamDisabled":  jetStreamDisabled,
		"jetStreamNoAccount": jetStreamNoAccount,
		"monitorAbsent":      monitorAbsent,
		"monitorUnreachable": monitorUnreachable,
		"systemAbsent":       systemAbsent,
		"systemForbidden":    systemForbidden,
	}
	for name, reason := range reasons {
		if !strings.HasPrefix(reason, "mq.nats.degraded.") {
			t.Errorf("%s = %q, want a key under mq.nats.degraded.", name, reason)
		}
		if strings.Contains(reason, " ") {
			t.Errorf("%s = %q, which is a sentence rather than a key", name, reason)
		}
	}
}

// Every reason must be distinct. Two tiers sharing one key is the same failure
// as writing prose: the page says something true and useless.
func TestDegradeReasonsAreDistinct(t *testing.T) {
	seen := map[string]bool{}
	for _, reason := range []string{
		jetStreamDisabled, jetStreamNoAccount,
		monitorAbsent, monitorUnreachable,
		systemAbsent, systemForbidden,
	} {
		if seen[reason] {
			t.Errorf("%q is used for more than one tier", reason)
		}
		seen[reason] = true
	}
}

// A connection that opened can always be pinged, whatever else is missing.
func TestPingAnswersOnACoreOnlyServer(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

// The registry closes on disconnect and again on shutdown.
func TestCloseIsSafeTwice(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{monitor: true, systemAccount: true}), true, true)
	if err := conn.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

// A closed connection reports that it is closed rather than the network error
// underneath, because the two lead somewhere different.
func TestPingOnAClosedConnectionSaysSo(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	_ = conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err == nil {
		t.Fatal("Ping on a closed connection returned no error")
	}
}

// Whatever the probe found, the declared capabilities and the implemented
// interfaces have to agree - on every combination of tiers, not just the one
// where everything answers.
func TestConformanceHoldsOnEveryTierCombination(t *testing.T) {
	cases := []struct {
		name    string
		options serverOptions
	}{
		{"all four tiers", serverOptions{jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true}},
		{"no jetstream", serverOptions{monitor: true, systemAccount: true}},
		{"no monitoring", serverOptions{jetStream: true, jetStreamAccount: true, systemAccount: true}},
		{"no system account", serverOptions{jetStream: true, jetStreamAccount: true, monitor: true}},
		{"core only", serverOptions{}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			fake := startServer(t, test.options)
			conn := open(t, fake, fake.monitorURL != "", test.options.systemAccount)
			for _, problem := range driver.CheckConformance(conn) {
				t.Error(problem)
			}
		})
	}
}
