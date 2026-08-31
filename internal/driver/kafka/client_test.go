package kafka

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestParseSeeds(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"single host and port", "localhost:9092", []string{"localhost:9092"}},
		{"bare host takes the default port", "localhost", []string{"localhost:9092"}},
		{"comma separated", "a:9092,b:9093", []string{"a:9092", "b:9093"}},
		{"semicolon separated", "a:9092;b:9093", []string{"a:9092", "b:9093"}},
		{"whitespace separated", "a:9092 b:9093", []string{"a:9092", "b:9093"}},
		{"newline separated", "a:9092\nb:9093", []string{"a:9092", "b:9093"}},
		{"mixed separators and padding", " a:9092 ,\n b ", []string{"a:9092", "b:9092"}},
		{"duplicates collapse", "a:9092,a:9092", []string{"a:9092"}},
		{"a pasted scheme is stripped", "kafka://a:9092", []string{"a:9092"}},
		{"a pasted url keeps its port", "PLAINTEXT://a:9094/", []string{"a:9094"}},
		{"ipv4", "127.0.0.1", []string{"127.0.0.1:9092"}},
		{"bracketed ipv6 with a port", "[::1]:9092", []string{"[::1]:9092"}},
		{"bare ipv6 is bracketed before the port is added", "::1", []string{"[::1]:9092"}},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			seeds, err := parseSeeds(test.raw)
			if err != nil {
				t.Fatalf("parseSeeds(%q) failed: %v", test.raw, err)
			}
			if strings.Join(seeds, ",") != strings.Join(test.want, ",") {
				t.Errorf("parseSeeds(%q) = %v, want %v", test.raw, seeds, test.want)
			}
		})
	}
}

func TestParseSeedsRejectsAnEmptyList(t *testing.T) {
	for _, raw := range []string{"", "   ", ",", " ,\n;\t "} {
		if _, err := parseSeeds(raw); err == nil {
			t.Errorf("parseSeeds(%q) succeeded, want an error", raw)
		}
	}
}

func TestClientIDNamesTheProfile(t *testing.T) {
	cases := []struct {
		name    string
		profile string
		want    string
	}{
		{"unnamed profile", "", "mq-studio"},
		{"plain name", "prod", "mq-studio.prod"},
		{"dots and dashes survive", "prod-cn.1", "mq-studio.prod-cn.1"},
		{"spaces and cjk become dashes", "生产 集群", "mq-studio.-----"},
		{"a slash cannot reach the broker", "a/b", "mq-studio.a-b"},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := clientID(test.profile); got != test.want {
				t.Errorf("clientID(%q) = %q, want %q", test.profile, got, test.want)
			}
		})
	}
}

// The timeout the connection form collects has to reach the dial, or the field
// is decoration. It has happened here before: every stored profile carried a
// positive default that the dial then ignored.
func TestConfigOfCarriesTheProfileTimeout(t *testing.T) {
	profile := model.ConnectionProfile{Endpoints: "localhost:9092", TimeoutSec: 12}

	config, err := configOf(profile)
	if err != nil {
		t.Fatalf("configOf failed: %v", err)
	}
	if config.DialTimeout != 12*time.Second {
		t.Errorf("dial timeout = %v, want 12s", config.DialTimeout)
	}

	profile.TimeoutSec = 0
	config, err = configOf(profile)
	if err != nil {
		t.Fatalf("configOf failed: %v", err)
	}
	if config.DialTimeout != defaultDialTimeout {
		t.Errorf("dial timeout = %v, want the %v default", config.DialTimeout, defaultDialTimeout)
	}
}

func TestSASLMechanismFollowsTheProfile(t *testing.T) {
	cases := []struct {
		name      string
		mechanism model.AuthMechanism
		scramSHA  string
		want      string
		wantErr   bool
	}{
		{name: "unset means no sasl", mechanism: "", want: ""},
		{name: "none means no sasl", mechanism: model.AuthNone, want: ""},
		{name: "plain", mechanism: model.AuthSASLPlain, want: "PLAIN"},
		{name: "scram defaults to the stronger digest", mechanism: model.AuthSASLScram, want: "SCRAM-SHA-512"},
		{name: "scram 256", mechanism: model.AuthSASLScram, scramSHA: "256", want: "SCRAM-SHA-256"},
		{name: "scram 512", mechanism: model.AuthSASLScram, scramSHA: "512", want: "SCRAM-SHA-512"},
		{name: "an unknown digest is refused", mechanism: model.AuthSASLScram, scramSHA: "1", wantErr: true},
		{name: "an unusable mechanism is refused", mechanism: model.AuthACL, wantErr: true},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			mechanism, err := saslMechanism(clientConfig{
				Mechanism: test.mechanism,
				SCRAMSHA:  test.scramSHA,
				Username:  "u",
				Password:  "p",
			})
			if test.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("saslMechanism failed: %v", err)
			}
			if test.want == "" {
				if mechanism != nil {
					t.Errorf("got mechanism %q, want none", mechanism.Name())
				}
				return
			}
			if mechanism == nil {
				t.Fatalf("got no mechanism, want %q", test.want)
			}
			if mechanism.Name() != test.want {
				t.Errorf("mechanism = %q, want %q", mechanism.Name(), test.want)
			}
		})
	}
}

// A password that reaches a log or an error string outlives the session it was
// typed into, and the two places it could leak from are the client id - which
// the broker records - and the error a bad config returns.
func TestPasswordNeverReachesTheClientIDOrAnError(t *testing.T) {
	const password = "s3cr3t-passphrase"
	profile := model.ConnectionProfile{
		Name:      "prod",
		Endpoints: "localhost:9092",
		Auth:      model.AuthConfig{Mechanism: model.AuthSASLScram},
		Options:   map[string]string{OptionSCRAMSHA: "not-a-digest"},
		Secrets:   map[string]string{SecretUsername: "admin", SecretPassword: password},
	}

	config, err := configOf(profile)
	if err != nil {
		t.Fatalf("configOf failed: %v", err)
	}
	if strings.Contains(config.ClientID, password) {
		t.Errorf("client id %q carries the password", config.ClientID)
	}

	_, err = dialOptions(config)
	if err == nil {
		t.Fatal("expected the bad digest to be refused")
	}
	if strings.Contains(err.Error(), password) {
		t.Errorf("error %q carries the password", err)
	}
}

func TestTLSConfigFollowsTheProfile(t *testing.T) {
	t.Run("off leaves the dial on plaintext", func(t *testing.T) {
		settings, err := tlsConfigFor(clientConfig{TLS: false, TLSSkipVerify: true})
		if err != nil {
			t.Fatalf("tlsConfigFor failed: %v", err)
		}
		if settings != nil {
			t.Error("TLS is off but a config was produced")
		}
	})

	t.Run("skip verify is off unless asked for", func(t *testing.T) {
		settings, err := tlsConfigFor(clientConfig{TLS: true})
		if err != nil {
			t.Fatalf("tlsConfigFor failed: %v", err)
		}
		if settings.InsecureSkipVerify {
			t.Error("verification was skipped without being asked for")
		}
		if settings.MinVersion != 0x0303 {
			t.Errorf("minimum TLS version = %#x, want TLS 1.2", settings.MinVersion)
		}
	})

	t.Run("skip verify is honoured when asked for", func(t *testing.T) {
		settings, err := tlsConfigFor(clientConfig{TLS: true, TLSSkipVerify: true})
		if err != nil {
			t.Fatalf("tlsConfigFor failed: %v", err)
		}
		if !settings.InsecureSkipVerify {
			t.Error("verification was not skipped although it was asked for")
		}
	})
}

func TestTLSCAFile(t *testing.T) {
	directory := t.TempDir()

	t.Run("a missing file is refused rather than ignored", func(t *testing.T) {
		_, err := tlsConfigFor(clientConfig{
			TLS:       true,
			TLSCAFile: filepath.Join(directory, "absent.pem"),
		})
		if err == nil {
			t.Fatal("expected a missing CA file to be an error")
		}
	})

	t.Run("a file with no certificate in it is refused", func(t *testing.T) {
		path := filepath.Join(directory, "empty.pem")
		if err := os.WriteFile(path, []byte("not a certificate\n"), 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
		_, err := tlsConfigFor(clientConfig{TLS: true, TLSCAFile: path})
		if err == nil {
			t.Fatal("expected a CA file with no certificate to be an error")
		}
	})

	t.Run("a real certificate becomes the root pool", func(t *testing.T) {
		path := filepath.Join(directory, "ca.pem")
		if err := os.WriteFile(path, []byte(testCAPEM), 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
		settings, err := tlsConfigFor(clientConfig{TLS: true, TLSCAFile: path})
		if err != nil {
			t.Fatalf("tlsConfigFor failed: %v", err)
		}
		if settings.RootCAs == nil {
			t.Fatal("the CA file was accepted but no root pool was built")
		}
	})
}

// A self-signed CA, generated once and pinned here so the test needs no
// crypto setup of its own. It is only ever parsed.
const testCAPEM = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIQIRi6zePL6mKjOipn+dNuaTAKBggqhkjOPQQDAjASMRAw
DgYDVQQKEwdBY21lIENvMB4XDTE3MTAyMDE5NDMwNloXDTE4MTAyMDE5NDMwNlow
EjEQMA4GA1UEChMHQWNtZSBDbzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABD0d
7VNhbWvZLWPuj/RtHFjvtJBEwOkhbN/BnnE8rnZR8+sbwnc/KhCk3FhnpHZnQz7B
5aETbbIgmuvewdjvSBSjYzBhMA4GA1UdDwEB/wQEAwICpDATBgNVHSUEDDAKBggr
BgEFBQcDATAPBgNVHRMBAf8EBTADAQH/MCkGA1UdEQQiMCCCDmxvY2FsaG9zdDo1
NDUzgg4xMjcuMC4wLjE6NTQ1MzAKBggqhkjOPQQDAgNIADBFAiEA2zpJEPQyz6/l
Wf86aX6PepsntZv2GYlA5UpabfT2EZICICpJ5h/iI+i341gBmLiAFQOyTDT+/wQc
6MF9+Yw1Yy0t
-----END CERTIFICATE-----
`
