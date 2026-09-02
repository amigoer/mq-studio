package pulsar

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// The connection form asks for an address, and people type a URL, a host and
// a host:port. All three have to reach the same broker, because the one that
// silently does not is the one nobody debugs - it looks like the cluster is
// down.
func TestNormaliseServiceURL(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "a full url is kept", raw: "pulsar://broker:6650", want: "pulsar://broker:6650"},
		{name: "a bare host gets the scheme and the port", raw: "broker", want: "pulsar://broker:6650"},
		{name: "a host and port only needs the scheme", raw: "broker:6651", want: "pulsar://broker:6651"},
		{name: "tls keeps its scheme", raw: "pulsar+ssl://broker:6651", want: "pulsar+ssl://broker:6651"},
		{name: "surrounding space is not part of an address", raw: "  broker:6650 ", want: "pulsar://broker:6650"},
		{name: "a trailing slash is not part of an address", raw: "pulsar://broker:6650/", want: "pulsar://broker:6650"},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := normaliseServiceURL(test.raw)
			if err != nil {
				t.Fatalf("normaliseServiceURL(%q): %v", test.raw, err)
			}
			if got != test.want {
				t.Errorf("normaliseServiceURL(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}

// An http address in the service URL field is the mistake worth catching
// early: it is the admin URL, pasted one field too high, and pulsar-client-go
// accepts it and then fails on the first read with a protocol error nobody can
// trace back to the form.
func TestNormaliseServiceURLRefusesWhatCannotBeDialled(t *testing.T) {
	for _, raw := range []string{"", "   ", "http://broker:8080", "https://broker:8443"} {
		if _, err := normaliseServiceURL(raw); err == nil {
			t.Errorf("normaliseServiceURL(%q) was accepted", raw)
		}
	}
}

func TestNormaliseAdminURL(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "a full url is kept", raw: "http://broker:8080", want: "http://broker:8080"},
		{name: "a bare host defaults to http", raw: "broker:8080", want: "http://broker:8080"},
		{name: "tls keeps its scheme", raw: "https://broker:8443", want: "https://broker:8443"},
		{name: "a trailing slash is not part of an address", raw: "http://broker:8080/", want: "http://broker:8080"},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := normaliseAdminURL(test.raw)
			if err != nil {
				t.Fatalf("normaliseAdminURL(%q): %v", test.raw, err)
			}
			if got != test.want {
				t.Errorf("normaliseAdminURL(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}

// The mirror of the mistake above: a pulsar:// address in the admin field.
func TestNormaliseAdminURLRefusesWhatCannotBeCalled(t *testing.T) {
	for _, raw := range []string{"", "   ", "pulsar://broker:6650", "pulsar+ssl://broker:6651"} {
		if _, err := normaliseAdminURL(raw); err == nil {
			t.Errorf("normaliseAdminURL(%q) was accepted", raw)
		}
	}
}

func profile(options map[string]string, secrets map[string]string, mechanism model.AuthMechanism) model.ConnectionProfile {
	built := model.ConnectionProfile{
		Endpoints: "pulsar://broker:6650",
		Options:   map[string]string{OptionAdminURL: "http://broker:8080"},
		Secrets:   map[string]string{},
		Auth:      model.AuthConfig{Mechanism: mechanism},
	}
	for key, value := range options {
		built.Options[key] = value
	}
	for key, value := range secrets {
		built.Secrets[key] = value
	}
	return built
}

// A Pulsar topic is addressed as tenant/namespace/name, so a profile that
// names neither has no scope to read within. public/default is what a stock
// cluster ships with, and it is what the form defaults to.
func TestConfigDefaultsTheScope(t *testing.T) {
	config, err := configOf(profile(nil, nil, model.AuthNone))
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if config.Tenant != defaultTenant {
		t.Errorf("tenant = %q, want %q", config.Tenant, defaultTenant)
	}
	if config.Namespace != defaultNamespace {
		t.Errorf("namespace = %q, want %q", config.Namespace, defaultNamespace)
	}
}

/*
 * Turning authentication off has to drop the token.
 *
 * A profile keeps its secrets when the mechanism is switched to none - that is
 * deliberate, so switching back does not mean typing the token again. But the
 * connection has to honour the switch, or "none" is a control that changes
 * nothing and the next connection still authenticates.
 */
func TestConfigCarriesTheTokenOnlyWhenAuthenticationIsOn(t *testing.T) {
	secrets := map[string]string{SecretToken: "a-jwt"}

	authenticating, err := configOf(profile(nil, secrets, model.AuthToken))
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if authenticating.Token != "a-jwt" {
		t.Errorf("token = %q, want the stored one", authenticating.Token)
	}

	off, err := configOf(profile(nil, secrets, model.AuthNone))
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if off.Token != "" {
		t.Errorf("token = %q with authentication off, want none", off.Token)
	}
}

// The timeout the form collects is the one that bounds reaching the host. Its
// absence is not zero: a zero dial timeout is no timeout at all, which is the
// five-minute hang this driver exists to avoid.
func TestConfigTimeoutFallsBackRatherThanBeingZero(t *testing.T) {
	config, err := configOf(profile(nil, nil, model.AuthNone))
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if config.Timeout != defaultDialTimeout {
		t.Errorf("timeout = %v, want %v", config.Timeout, defaultDialTimeout)
	}

	explicit := profile(nil, nil, model.AuthNone)
	explicit.TimeoutSec = 12
	config, err = configOf(explicit)
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	if config.Timeout != 12*time.Second {
		t.Errorf("timeout = %v, want 12s", config.Timeout)
	}
}

/*
 * A rejected address must not quote the token back.
 *
 * configOf reports what it refuses, and those errors reach the connection
 * dialog and the log. A token is a bearer credential: printing it once puts it
 * somewhere it can be read later by anyone who can read the log.
 */
func TestConfigErrorsDoNotCarryTheToken(t *testing.T) {
	const token = "super-secret-jwt"
	broken := profile(nil, map[string]string{SecretToken: token}, model.AuthToken)
	broken.Endpoints = "http://wrong-field:8080"

	_, err := configOf(broken)
	if err == nil {
		t.Fatal("an http service URL was accepted")
	}
	if strings.Contains(err.Error(), token) {
		t.Errorf("the error quotes the token: %v", err)
	}
}

// The admin transport is this driver's, not the library's: pulsaradmin builds
// an http.Client with a five-minute timeout and no way to change it, so a
// transport carrying the profile's own dial timeout is the only thing bounding
// how long reaching a dead host takes.
func TestAdminTransportCarriesTheProfileTimeout(t *testing.T) {
	config := clientConfig{AdminURL: "http://broker:8080", Timeout: 3 * time.Second}

	_, transport, err := newAdmin(config)
	if err != nil {
		t.Fatalf("newAdmin: %v", err)
	}
	installed, ok := transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport is %T, want *http.Transport", transport)
	}
	if installed.TLSHandshakeTimeout != 3*time.Second {
		t.Errorf("TLS handshake timeout = %v, want the profile's 3s", installed.TLSHandshakeTimeout)
	}
}

// TLS settings are only applied when the profile asked for TLS. An empty
// tls.Config on a plaintext connection is not the same as none: it changes
// what the transport negotiates.
func TestTLSConfigIsAbsentUnlessAskedFor(t *testing.T) {
	if got := tlsConfigFor(clientConfig{TLS: false, TLSSkipVerify: true}); got != nil {
		t.Errorf("tlsConfigFor gave a config for a plaintext connection: %#v", got)
	}

	got := tlsConfigFor(clientConfig{TLS: true, TLSSkipVerify: true})
	if got == nil {
		t.Fatal("tlsConfigFor gave no config for a TLS connection")
	}
	if !got.InsecureSkipVerify {
		t.Error("the profile asked to skip verification and the config verifies")
	}
}
