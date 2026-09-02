package nats

import (
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// The address field takes what a person pastes, which is a URL about half the
// time and a host:port the rest of it.
func TestServerAddressesTakeEveryShapeSomebodyTypes(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{
			name: "a bare host gets the default port and a scheme",
			raw:  "127.0.0.1",
			want: []string{"nats://127.0.0.1:4222"},
		},
		{
			name: "a host and port get only the scheme",
			raw:  "nats.internal:4333",
			want: []string{"nats://nats.internal:4333"},
		},
		{
			name: "a full URL is left alone",
			raw:  "nats://nats.internal:4333",
			want: []string{"nats://nats.internal:4333"},
		},
		{
			name: "tls keeps its scheme and still gets the default port",
			raw:  "tls://secure.internal",
			want: []string{"tls://secure.internal:4222"},
		},
		{
			// A websocket endpoint is served on whatever port the operator
			// chose. There is no convention to guess at, and guessing 4222
			// would send the client somewhere that speaks another protocol.
			name: "a websocket address is not given a default port",
			raw:  "wss://gateway.internal/nats",
			want: []string{"wss://gateway.internal/nats"},
		},
		{
			name: "commas, semicolons and whitespace all separate",
			raw:  "one:4222, two:4223 ;three:4224\nfour:4225",
			want: []string{
				"nats://one:4222", "nats://two:4223",
				"nats://three:4224", "nats://four:4225",
			},
		},
		{
			// A duplicate is not a second server to try, it is the same one
			// twice, and the client would count it as extra capacity.
			name: "the same server twice collapses to once",
			raw:  "host:4222,nats://host:4222,host",
			want: []string{"nats://host:4222"},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseServers(test.raw)
			if err != nil {
				t.Fatalf("parseServers(%q): %v", test.raw, err)
			}
			if strings.Join(got, ",") != strings.Join(test.want, ",") {
				t.Errorf("parseServers(%q) = %v, want %v", test.raw, got, test.want)
			}
		})
	}
}

func TestServerAddressesRejectWhatCannotBeDialled(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"nothing at all", ""},
		{"only separators", " , ; "},
		{"a scheme that is not nats", "http://127.0.0.1:8222"},
		{"a port with no host", ":4222"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got, err := parseServers(test.raw); err == nil {
				t.Errorf("parseServers(%q) = %v, want an error", test.raw, got)
			}
		})
	}
}

func TestTheMonitoringAddressIsOptionalAndNormalised(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		// Empty is the ordinary case: the endpoint is off unless the operator
		// started the server with -m, so an unset field is not a mistake.
		{name: "empty stays empty", raw: "", want: ""},
		{name: "a bare address gets http", raw: "127.0.0.1:8222", want: "http://127.0.0.1:8222"},
		{name: "https is kept", raw: "https://nats.internal:8222", want: "https://nats.internal:8222"},
		{name: "a trailing slash goes", raw: "http://nats.internal:8222/", want: "http://nats.internal:8222"},
		{name: "a nats scheme is not a monitoring endpoint", raw: "nats://127.0.0.1:4222", wantErr: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := normaliseMonitorURL(test.raw)
			if test.wantErr {
				if err == nil {
					t.Fatalf("normaliseMonitorURL(%q) = %q, want an error", test.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normaliseMonitorURL(%q): %v", test.raw, err)
			}
			if got != test.want {
				t.Errorf("normaliseMonitorURL(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}

// A credential is read only under the mechanism that uses it.
//
// A profile carrying a token and set to "none" is one somebody switched off,
// and a driver that used the token anyway would make the control on the form
// mean nothing - the user would turn authentication off, see it still working,
// and have no way to find out why.
func TestACredentialIsReadOnlyUnderItsOwnMechanism(t *testing.T) {
	full := func(mechanism model.AuthMechanism) model.ConnectionProfile {
		profile := model.ConnectionProfile{
			Kind:      model.KindNATS,
			Endpoints: "127.0.0.1:4222",
			Auth:      model.AuthConfig{Mechanism: mechanism},
			Options:   map[string]string{OptionCredsFile: "/tmp/user.creds"},
			Secrets:   map[string]string{},
		}
		profile.SetSecret(SecretUsername, "someone")
		profile.SetSecret(SecretPassword, "a-password")
		profile.SetSecret(SecretToken, "a-token")
		profile.SetSecret(SecretNKeySeed, "SUAseed")
		return profile
	}

	cases := []struct {
		name      string
		mechanism model.AuthMechanism
		want      func(clientConfig) bool
	}{
		{
			name:      "none reads nothing",
			mechanism: model.AuthNone,
			want: func(c clientConfig) bool {
				return c.Username == "" && c.Password == "" && c.Token == "" &&
					c.NKeySeed == "" && c.CredsFile == ""
			},
		},
		{
			name:      "plain reads only the user and password",
			mechanism: model.AuthPlain,
			want: func(c clientConfig) bool {
				return c.Username == "someone" && c.Password == "a-password" &&
					c.Token == "" && c.NKeySeed == "" && c.CredsFile == ""
			},
		},
		{
			name:      "token reads only the token",
			mechanism: model.AuthToken,
			want: func(c clientConfig) bool {
				return c.Token == "a-token" && c.Username == "" && c.NKeySeed == ""
			},
		},
		{
			name:      "nkey reads only the seed",
			mechanism: model.AuthNKey,
			want: func(c clientConfig) bool {
				return c.NKeySeed == "SUAseed" && c.Token == "" && c.Username == ""
			},
		},
		{
			name:      "creds reads only the path",
			mechanism: model.AuthCreds,
			want: func(c clientConfig) bool {
				return c.CredsFile == "/tmp/user.creds" && c.NKeySeed == "" && c.Token == ""
			},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			config, err := configOf(full(test.mechanism))
			if err != nil {
				t.Fatalf("configOf: %v", err)
			}
			if !test.want(config) {
				t.Errorf("configOf under %s read the wrong credentials: %+v", test.mechanism, redacted(config))
			}
		})
	}
}

// The system-account credentials are read whatever the mechanism, because they
// are a second account rather than a second way of reaching the first one.
func TestSystemCredentialsAreIndependentOfTheMechanism(t *testing.T) {
	profile := model.ConnectionProfile{
		Kind:      model.KindNATS,
		Endpoints: "127.0.0.1:4222",
		Auth:      model.AuthConfig{Mechanism: model.AuthToken},
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	profile.SetSecret(SecretToken, "a-token")
	profile.SetSecret(SecretSystemUser, "sys")
	profile.SetSecret(SecretSystemPassword, "sys-secret")

	config, err := configOf(profile)
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if config.SystemUser != "sys" || config.SystemPassword != "sys-secret" {
		t.Errorf("system credentials = %q/%q, want sys/sys-secret", config.SystemUser, config.SystemPassword)
	}
}

// The system connection carries the system account's credentials and none of
// the profile's own. Sending both would authenticate as whichever the server
// preferred, which is not a thing to leave to the server.
func TestTheSystemConnectionDropsTheProfilesOwnCredentials(t *testing.T) {
	config := clientConfig{
		Servers:        []string{"nats://127.0.0.1:4222"},
		Mechanism:      model.AuthToken,
		Token:          "a-token",
		SystemUser:     "sys",
		SystemPassword: "sys-secret",
		DialTimeout:    time.Second,
	}
	if _, err := config.systemDialOptions(); err != nil {
		t.Fatalf("systemDialOptions: %v", err)
	}
}

// An nkey seed that is not one has to be refused here rather than at the
// server, which would report it as a failed authentication and send the user
// looking at the account instead of at the field they typed into.
func TestAnInvalidNkeySeedIsRefusedBeforeDialling(t *testing.T) {
	if _, err := nkeyOption("not-a-seed"); err == nil {
		t.Fatal("nkeyOption accepted a seed that is not one")
	}
	if _, err := nkeyOption(""); err == nil {
		t.Fatal("nkeyOption accepted an empty seed")
	}
}

// A client certificate with no key cannot be presented. Reporting it at dial
// time reads as the server refusing the connection, which is a different
// problem from a form filled in half way.
func TestHalfAClientCertificateIsRefused(t *testing.T) {
	config := clientConfig{
		Servers:     []string{"tls://127.0.0.1:4222"},
		TLS:         true,
		TLSCertFile: "/tmp/cert.pem",
	}
	if _, err := config.tlsConfig(); err == nil {
		t.Fatal("tlsConfig accepted a certificate with no key")
	}
}

// A tls:// address turns TLS on by itself. Making the user tick a box as well
// would let a profile ask for a secure transport and dial in the clear.
func TestATlsAddressTurnsOnTls(t *testing.T) {
	config := clientConfig{Servers: []string{"tls://127.0.0.1:4222"}}
	settings, err := config.tlsConfig()
	if err != nil {
		t.Fatalf("tlsConfig: %v", err)
	}
	if settings == nil {
		t.Fatal("a tls:// address produced no TLS configuration")
	}
}

// redacted is what a failure message may print: everything but the secrets.
func redacted(c clientConfig) map[string]any {
	return map[string]any{
		"servers":      c.Servers,
		"mechanism":    c.Mechanism,
		"hasUsername":  c.Username != "",
		"hasPassword":  c.Password != "",
		"hasToken":     c.Token != "",
		"hasNKeySeed":  c.NKeySeed != "",
		"credsFile":    c.CredsFile,
		"monitorURL":   c.MonitorURL,
		"hasSystemAcc": c.SystemUser != "",
	}
}
