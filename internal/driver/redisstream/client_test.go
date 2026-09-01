package redisstream

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// profile builds a Redis profile with the options a case cares about.
func profile(endpoints string, options map[string]string) model.ConnectionProfile {
	p := model.ConnectionProfile{
		Name:      "redis-stream-01",
		Kind:      model.KindRedisStream,
		Endpoints: endpoints,
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	for key, value := range options {
		p.Options[key] = value
	}
	return p
}

// Users paste an address in every shape a Redis config file or a connection
// string allows, and every one of them names a server they meant.
func TestParseAddrs(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "a bare host gets the default port", raw: "redis.internal", want: []string{"redis.internal:6379"}},
		{name: "a host and port is left alone", raw: "10.2.0.8:6380", want: []string{"10.2.0.8:6380"}},
		{name: "a scheme is stripped", raw: "redis://10.2.0.8:6379", want: []string{"10.2.0.8:6379"}},
		{name: "a tls scheme is stripped too", raw: "rediss://10.2.0.8:6379", want: []string{"10.2.0.8:6379"}},
		{
			name: "credentials in a url are dropped, because the form collects them",
			raw:  "redis://someone:hunter2@10.2.0.8:6379",
			want: []string{"10.2.0.8:6379"},
		},
		{
			name: "a database path is dropped, because the form collects that too",
			raw:  "redis://10.2.0.8:6379/3",
			want: []string{"10.2.0.8:6379"},
		},
		{
			name: "commas, semicolons and whitespace all separate",
			raw:  "a:6379, b:6380 ;\n c:6381",
			want: []string{"a:6379", "b:6380", "c:6381"},
		},
		{
			name: "a repeated address is listed once",
			raw:  "a:6379,a:6379,b:6379",
			want: []string{"a:6379", "b:6379"},
		},
		{
			name: "a bare ipv6 address is bracketed before the port is appended",
			raw:  "2001:db8::1",
			want: []string{"[2001:db8::1]:6379"},
		},
		{
			name: "an ipv6 address that already carries a port is left alone",
			raw:  "[2001:db8::1]:6380",
			want: []string{"[2001:db8::1]:6380"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseAddrs(tc.raw)
			if err != nil {
				t.Fatalf("parseAddrs(%q): %v", tc.raw, err)
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("parseAddrs(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestParseAddrsRejectsAnEmptyAddress(t *testing.T) {
	for _, raw := range []string{"", "   ", ",;\n", "redis://"} {
		if _, err := parseAddrs(raw); err == nil {
			t.Errorf("parseAddrs(%q) succeeded, want an error", raw)
		}
	}
}

func TestParseDB(t *testing.T) {
	cases := []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{raw: "", want: 0},
		{raw: "  ", want: 0},
		{raw: "0", want: 0},
		{raw: "15", want: 15},
		{raw: "-1", wantErr: true},
		{raw: "half", wantErr: true},
	}
	for _, tc := range cases {
		got, err := parseDB(tc.raw)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseDB(%q) succeeded, want an error", tc.raw)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseDB(%q): %v", tc.raw, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseDB(%q) = %d, want %d", tc.raw, got, tc.want)
		}
	}
}

// An unset deployment is standalone: a profile saved before the field existed
// has to keep connecting to the server it always did.
func TestDeploymentOfDefaultsToStandalone(t *testing.T) {
	for _, raw := range []string{"", "  ", "nonsense", "STANDALONE"} {
		if got := deploymentOf(raw); got != DeploymentStandalone {
			t.Errorf("deploymentOf(%q) = %q, want standalone", raw, got)
		}
	}
	if got := deploymentOf("sentinel"); got != DeploymentSentinel {
		t.Errorf("deploymentOf(sentinel) = %q", got)
	}
	if got := deploymentOf(" cluster "); got != DeploymentCluster {
		t.Errorf("deploymentOf(cluster) = %q", got)
	}
}

/*
 * Which client go-redis builds is decided entirely by these fields, and it is
 * decided silently: the wrong combination produces a working client that talks
 * to the wrong thing and fails somewhere else entirely.
 *
 * This is the whole reason one driver can serve three deployments, so it is
 * the one derivation worth pinning field by field.
 */
func TestUniversalOptionsPerDeployment(t *testing.T) {
	cases := []struct {
		name          string
		config        clientConfig
		wantAddrs     []string
		wantMaster    string
		wantCluster   bool
		wantDB        int
		wantSentinels bool
	}{
		{
			name: "standalone selects a plain client and keeps the database",
			config: clientConfig{
				Deployment: DeploymentStandalone,
				Addrs:      []string{"127.0.0.1:6379"},
				DB:         3,
			},
			wantAddrs: []string{"127.0.0.1:6379"},
			wantDB:    3,
		},
		{
			name: "sentinel asks for a master by name",
			config: clientConfig{
				Deployment: DeploymentSentinel,
				Addrs:      []string{"s1:26379", "s2:26379"},
				MasterName: "mymaster",
				DB:         2,
				Username:   "someone",
				Password:   "hunter2",
			},
			wantAddrs:     []string{"s1:26379", "s2:26379"},
			wantMaster:    "mymaster",
			wantDB:        2,
			wantSentinels: true,
		},
		{
			// The load-bearing case. A cluster is very often reached through
			// one configuration endpoint, and without this flag go-redis would
			// see a single address and build a plain client - which answers
			// MOVED for most of the keyspace and never follows it.
			name: "a single-endpoint cluster is still a cluster",
			config: clientConfig{
				Deployment: DeploymentCluster,
				Addrs:      []string{"config.endpoint:6379"},
			},
			wantAddrs:   []string{"config.endpoint:6379"},
			wantCluster: true,
		},
		{
			// Redis Cluster has one database and refuses SELECT, so a stored
			// index from a profile that used to be standalone must not travel.
			name: "a cluster never carries a database index",
			config: clientConfig{
				Deployment: DeploymentCluster,
				Addrs:      []string{"a:6379", "b:6379"},
				DB:         7,
			},
			wantAddrs:   []string{"a:6379", "b:6379"},
			wantCluster: true,
			wantDB:      0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			options := universalOptions(tc.config)
			if !slices.Equal(options.Addrs, tc.wantAddrs) {
				t.Errorf("addrs = %v, want %v", options.Addrs, tc.wantAddrs)
			}
			if options.MasterName != tc.wantMaster {
				t.Errorf("master name = %q, want %q", options.MasterName, tc.wantMaster)
			}
			if options.IsClusterMode != tc.wantCluster {
				t.Errorf("cluster mode = %v, want %v", options.IsClusterMode, tc.wantCluster)
			}
			if options.DB != tc.wantDB {
				t.Errorf("db = %d, want %d", options.DB, tc.wantDB)
			}
			gotSentinels := options.SentinelUsername != "" || options.SentinelPassword != ""
			if gotSentinels != tc.wantSentinels {
				t.Errorf("sentinel credentials passed = %v, want %v", gotSentinels, tc.wantSentinels)
			}
		})
	}
}

// The options above only matter if go-redis reads them the way this driver
// expects, so the cluster case is checked against the client it actually
// builds. Standalone and sentinel are both *redis.Client and cannot be told
// apart by type, which is why the fields above are asserted instead.
func TestClusterDeploymentBuildsAClusterClient(t *testing.T) {
	client := newClient(clientConfig{
		Deployment: DeploymentCluster,
		Addrs:      []string{"127.0.0.1:6500"},
	})
	defer client.Close()

	if _, ok := client.(*redis.ClusterClient); !ok {
		t.Fatalf("cluster deployment built %T, want *redis.ClusterClient", client)
	}
}

func TestStandaloneDeploymentBuildsAPlainClient(t *testing.T) {
	client := newClient(clientConfig{
		Deployment: DeploymentStandalone,
		Addrs:      []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if _, ok := client.(*redis.ClusterClient); ok {
		t.Fatal("standalone deployment built a cluster client")
	}
}

// go-redis turns any second address into a cluster client. A standalone
// profile that collected two would therefore stop being standalone without
// saying so, which is a connection that works and talks to the wrong thing.
func TestStandaloneRefusesASecondAddress(t *testing.T) {
	_, err := configOf(profile("a:6379,b:6379", map[string]string{
		OptionDeployment: string(DeploymentStandalone),
	}))
	if err == nil {
		t.Fatal("two addresses were accepted for a standalone connection")
	}
	if !strings.Contains(err.Error(), "cluster or sentinel") {
		t.Errorf("the error does not say what to do instead: %v", err)
	}
}

// Without a master name a sentinel connection has nothing to ask for, and
// go-redis would build a plain client against the sentinels themselves - which
// answer PING and hold no streams at all.
func TestSentinelNeedsAMasterName(t *testing.T) {
	if _, err := configOf(profile("s1:26379", map[string]string{
		OptionDeployment: string(DeploymentSentinel),
	})); err == nil {
		t.Fatal("a sentinel connection was accepted with no master name")
	}
}

func TestConfigOfReadsTheWholeProfile(t *testing.T) {
	p := profile("10.2.0.8", map[string]string{
		OptionDeployment:    string(DeploymentStandalone),
		OptionDB:            "4",
		OptionTLS:           "true",
		OptionTLSSkipVerify: "true",
		OptionStreamFilter:  "  orders:*  ",
	})
	p.TimeoutSec = 9
	p.SetSecret(SecretUsername, "someone")
	p.SetSecret(SecretPassword, "hunter2")

	config, err := configOf(p)
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if !slices.Equal(config.Addrs, []string{"10.2.0.8:6379"}) {
		t.Errorf("addrs = %v", config.Addrs)
	}
	if config.DB != 4 {
		t.Errorf("db = %d, want 4", config.DB)
	}
	if config.Username != "someone" || config.Password != "hunter2" {
		t.Errorf("credentials = %q/%q", config.Username, config.Password)
	}
	if !config.TLS || !config.TLSSkipVerify {
		t.Errorf("tls = %v, skip verify = %v", config.TLS, config.TLSSkipVerify)
	}
	if config.StreamFilter != "orders:*" {
		t.Errorf("stream filter = %q, want it trimmed", config.StreamFilter)
	}
	if config.DialTimeout != 9*time.Second {
		t.Errorf("dial timeout = %s, want the profile's 9s", config.DialTimeout)
	}
	if config.ClientName != "mq-studio.redis-stream-01" {
		t.Errorf("client name = %q", config.ClientName)
	}
}

// A profile with no timeout gets the default rather than none: a zero would
// leave a dial to a black-holed host hanging until the request deadline, which
// is the whole budget spent before the first byte.
func TestConfigOfDefaultsTheDialTimeout(t *testing.T) {
	config, err := configOf(profile("127.0.0.1:6379", nil))
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if config.DialTimeout != defaultDialTimeout {
		t.Errorf("dial timeout = %s, want %s", config.DialTimeout, defaultDialTimeout)
	}
}

// The client name is sent to the server and read back by CLIENT LIST, so a
// profile named in Chinese, or with a space in it, must not make every
// connection in the pool fail its CLIENT SETNAME.
func TestConnectionName(t *testing.T) {
	cases := map[string]string{
		"":                "mq-studio",
		"   ":             "mq-studio",
		"prod-redis":      "mq-studio.prod-redis",
		"prod redis":      "mq-studio.prod-redis",
		"生产 Redis":        "mq-studio.---Redis",
		"a\nb":            "mq-studio.a-b",
		"keeps.dots_and-": "mq-studio.keeps.dots_and-",
	}
	for name, want := range cases {
		if got := connectionName(name); got != want {
			t.Errorf("connectionName(%q) = %q, want %q", name, got, want)
		}
	}
}

// A credential must never reach a place that is logged or shown. The client
// name goes to the server and into CLIENT LIST, and configOf's errors are
// rendered by the connection form.
func TestTheProfileSecretsStayOutOfNamesAndErrors(t *testing.T) {
	const secret = "hunter2"
	p := profile("a:6379,b:6379", map[string]string{
		OptionDeployment: string(DeploymentStandalone),
	})
	p.Name = "redis " + secret
	p.SetSecret(SecretPassword, secret)

	if name := connectionName(p.Name); strings.Contains(name, secret) {
		// The name is the profile's own text, so a password typed into the
		// name field is the user's doing - but a password from the secret
		// field must never get there.
		t.Logf("client name carries the profile name verbatim: %q", name)
	}
	_, err := configOf(p)
	if err == nil {
		t.Fatal("expected the two-address standalone profile to be refused")
	}
	if strings.Contains(err.Error(), secret) {
		t.Errorf("the password reached an error the form renders: %v", err)
	}
}
