package nats

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"

	"github.com/amigoer/mq-studio/internal/model"
)

// The fixture below runs the real NATS server in this process.
//
// Every other family here is tested against a simulation - kfake for Kafka,
// miniredis for Redis, mochi for MQTT - because none of those brokers ships as
// a Go library. NATS does, and that matters more for this driver than it would
// for any of them: what it has to get right is which of four tiers answered,
// and each tier is a server option. A simulation would be a second opinion
// about what a server does with JetStream off; this is the answer.
//
// It is configured through a written config file rather than through the
// Options struct, because per-account JetStream is only expressible that way -
// Account.EnableJetStream needs an account a running server has already
// registered - and because it keeps these fixtures in the same language as
// tests/e2e/nats/nats.conf, where the two would otherwise drift apart.

// serverOptions is one fixture's shape: which of the tiers exist.
type serverOptions struct {
	// jetStream builds the server with the subsystem running.
	jetStream bool
	// jetStreamAccount grants it to the account the test connects as. False
	// with jetStream true is the second way JetStream can be missing, and the
	// one that has to be reported differently.
	jetStreamAccount bool
	// monitor serves the HTTP endpoint. It is a port, so the fixture takes a
	// free one and hands back its URL.
	monitor bool
	// systemAccount defines $SYS with a user in it. Without it the system tier
	// cannot be reached whatever credentials are offered.
	systemAccount bool
}

// fakeServer is a running server and the addresses to reach it on.
type fakeServer struct {
	server     *natsserver.Server
	clientURL  string
	monitorURL string
}

const (
	fakeUser           = "app"
	fakePassword       = "app-secret"
	fakeSystemUser     = "sys"
	fakeSystemPassword = "sys-secret"
)

// startServer runs a server for one test and stops it afterwards.
func startServer(t *testing.T, options serverOptions) *fakeServer {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "nats.conf")
	if err := os.WriteFile(path, []byte(serverConf(options, dir)), 0o600); err != nil {
		t.Fatalf("cannot write the fixture config: %v", err)
	}

	opts, err := natsserver.ProcessConfigFile(path)
	if err != nil {
		t.Fatalf("cannot read the fixture config: %v", err)
	}
	// Ports come from the process rather than the file: parallel tests each
	// need their own, and a fixed one would make this suite unrunnable beside
	// tests/e2e/nats.
	opts.Host = "127.0.0.1"
	opts.Port = -1
	opts.NoLog = true
	opts.NoSigs = true
	if options.monitor {
		opts.HTTPHost = "127.0.0.1"
		opts.HTTPPort = -1
	}

	server, err := natsserver.NewServer(opts)
	if err != nil {
		t.Fatalf("cannot build the test server: %v", err)
	}
	go server.Start()
	if !server.ReadyForConnections(10 * time.Second) {
		server.Shutdown()
		t.Fatal("the test server did not come up")
	}
	t.Cleanup(server.Shutdown)

	fake := &fakeServer{server: server, clientURL: server.ClientURL()}
	if options.monitor {
		fake.monitorURL = fmt.Sprintf("http://%s", server.MonitorAddr().String())
	}
	return fake
}

// serverConf writes the configuration for one combination of tiers.
func serverConf(options serverOptions, storeDir string) string {
	var conf strings.Builder
	if options.jetStream {
		fmt.Fprintf(&conf, "jetstream { store_dir: %q }\n", filepath.Join(storeDir, "js"))
	}

	conf.WriteString("accounts {\n")
	conf.WriteString("  APP: {\n")
	// Enabled per account as well as per server. Withholding this line on a
	// server that has JetStream is the second way it can be missing, and the
	// one the driver has to report differently.
	if options.jetStream && options.jetStreamAccount {
		conf.WriteString("    jetstream: enabled\n")
	}
	fmt.Fprintf(&conf, "    users: [ { user: %s, password: %s } ]\n", fakeUser, fakePassword)
	conf.WriteString("  }\n")

	if options.systemAccount {
		conf.WriteString("  SYS: {\n")
		fmt.Fprintf(&conf, "    users: [ { user: %s, password: %s } ]\n", fakeSystemUser, fakeSystemPassword)
		conf.WriteString("  }\n")
	}
	conf.WriteString("}\n")

	if options.systemAccount {
		conf.WriteString("system_account: SYS\n")
	}
	return conf.String()
}

// profile is a connection profile pointed at this server, with whichever
// optional tiers the caller wants configured.
func (f *fakeServer) profile(withMonitor, withSystem bool) model.ConnectionProfile {
	profile := model.ConnectionProfile{
		ID:        1,
		Name:      "fixture",
		Kind:      model.KindNATS,
		Endpoints: f.clientURL,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	profile.SetSecret(SecretUsername, fakeUser)
	profile.SetSecret(SecretPassword, fakePassword)
	if withMonitor {
		profile.SetOption(OptionMonitorURL, f.monitorURL)
	}
	if withSystem {
		profile.SetSecret(SecretSystemUser, fakeSystemUser)
		profile.SetSecret(SecretSystemPassword, fakeSystemPassword)
	}
	return profile
}
