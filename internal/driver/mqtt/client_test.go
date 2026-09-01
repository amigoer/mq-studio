package mqtt

import (
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// The address field is host:port and the transport picks the scheme, so a
// wrong answer here is a dial that fails with an error about the network when
// the actual fault is on the form.
func TestServerURLsBuildTheAddressTheTransportImplies(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		transport string
		wsPath    string
		want      []string
	}{
		{
			name: "a bare host takes the transport's port",
			raw:  "broker.internal",
			want: []string{"mqtt://broker.internal:1883"},
		},
		{
			name: "an explicit port is kept",
			raw:  "broker.internal:1884",
			want: []string{"mqtt://broker.internal:1884"},
		},
		{
			name:      "tls has its own default port",
			raw:       "broker.internal",
			transport: transportTLS,
			want:      []string{"mqtts://broker.internal:8883"},
		},
		{
			name:      "websocket carries the path from the form",
			raw:       "broker.internal",
			transport: transportWS,
			wsPath:    "mqtt",
			want:      []string{"ws://broker.internal:8083/mqtt"},
		},
		{
			name:      "a websocket path of / is no path at all",
			raw:       "broker.internal:9001",
			transport: transportWS,
			wsPath:    "/",
			want:      []string{"ws://broker.internal:9001"},
		},
		{
			name:      "secure websocket takes the tls path",
			raw:       "broker.internal",
			transport: transportWSS,
			wsPath:    "/mqtt",
			want:      []string{"wss://broker.internal:8084/mqtt"},
		},
		{
			// People paste what their broker's docs show them. The transport
			// on the form decides, so a pasted scheme is dropped rather than
			// silently overriding the field next to it.
			name: "a pasted scheme and path are dropped",
			raw:  "mqtts://broker.internal:8883/mqtt",
			want: []string{"mqtt://broker.internal:8883"},
		},
		{
			name: "every separator a config file uses splits the list",
			raw:  "a.internal:1883, b.internal:1883;\nc.internal:1883",
			want: []string{
				"mqtt://a.internal:1883",
				"mqtt://b.internal:1883",
				"mqtt://c.internal:1883",
			},
		},
		{
			name: "a repeated address is dialled once",
			raw:  "a.internal:1883, a.internal:1883",
			want: []string{"mqtt://a.internal:1883"},
		},
		{
			// Unbracketed, the last group of an IPv6 address reads as a port.
			name: "a bare ipv6 address is bracketed before the port is added",
			raw:  "fd00::1",
			want: []string{"mqtt://[fd00::1]:1883"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			servers, err := serverURLs(test.raw, test.transport, test.wsPath)
			if err != nil {
				t.Fatalf("serverURLs: %v", err)
			}

			got := make([]string, len(servers))
			for i, server := range servers {
				got[i] = server.String()
			}
			if strings.Join(got, " ") != strings.Join(test.want, " ") {
				t.Errorf("got %v, want %v", got, test.want)
			}
		})
	}
}

func TestServerURLsRefusesWhatItCannotDial(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		transport string
	}{
		{name: "nothing at all", raw: ""},
		{name: "only separators", raw: " ,;\n"},
		{name: "a transport with no scheme", raw: "broker.internal", transport: "carrier-pigeon"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := serverURLs(test.raw, test.transport, ""); err == nil {
				t.Error("serverURLs accepted an address it cannot dial")
			}
		})
	}
}

// A client id is an identity on the broker: two connections sharing one take
// turns disconnecting each other, and the symptom - a session that keeps
// dropping - reads as a broken network rather than as a duplicate id.
func TestClientIDIsUniquePerConnectionUnlessTheUserChoseOne(t *testing.T) {
	first, second := clientID(""), clientID("")
	if first == second {
		t.Errorf("two generated client ids are both %q; they must differ", first)
	}
	if !strings.HasPrefix(first, clientName) {
		t.Errorf("generated client id %q does not name the app", first)
	}

	// A configured id is passed through untouched: the user chose it because
	// the broker's access rules match on it.
	if got := clientID(" gateway-console "); got != "gateway-console" {
		t.Errorf("configured client id = %q, want %q", got, "gateway-console")
	}
}

func TestConfigOfReadsTheProfile(t *testing.T) {
	profile := model.ConnectionProfile{
		Name:       "edge",
		Kind:       model.KindMQTT,
		Endpoints:  "broker.internal:1883",
		TimeoutSec: 9,
		Auth:       model.AuthConfig{Mechanism: model.AuthPlain},
		Options: map[string]string{
			OptionProtocolVersion: protocol311,
			OptionClientID:        "edge-console",
			OptionKeepAliveSec:    "30",
			OptionCleanStart:      "false",
			OptionSessionExpiry:   "600",
		},
		Secrets: map[string]string{
			SecretUsername: "mqstudio",
			SecretPassword: "s3cret",
		},
	}

	config, err := configOf(profile)
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}

	if config.ProtocolV5 {
		t.Error("profile asked for 3.1.1 and got a 5.0 config")
	}
	if config.ClientID != "edge-console" {
		t.Errorf("client id = %q, want edge-console", config.ClientID)
	}
	if config.KeepAlive != 30*time.Second {
		t.Errorf("keep alive = %v, want 30s", config.KeepAlive)
	}
	if config.CleanStart {
		t.Error("clean start is on, but the profile turned it off")
	}
	if config.SessionExpiry != 600 {
		t.Errorf("session expiry = %d, want 600", config.SessionExpiry)
	}
	if config.DialTimeout != 9*time.Second {
		t.Errorf("dial timeout = %v, want 9s", config.DialTimeout)
	}
	if !config.Authenticates || config.Username != "mqstudio" || config.Password != "s3cret" {
		t.Errorf("credentials did not reach the config: %+v", config)
	}
	if config.TLS != nil {
		t.Error("a plaintext transport built a TLS config")
	}
}

// Defaults matter more here than usual: an MQTT profile can legitimately carry
// nothing but an address, and every unset field then decides how the session
// behaves.
func TestConfigOfDefaultsAProfileThatSaysOnlyTheAddress(t *testing.T) {
	config, err := configOf(model.ConnectionProfile{
		Kind:      model.KindMQTT,
		Endpoints: "broker.internal",
	})
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}

	if !config.ProtocolV5 {
		t.Error("an unset protocol version has to mean 5.0, which is what the form defaults to")
	}
	if !config.CleanStart {
		// A console that resumed a session would inherit whatever
		// subscriptions the last window left behind.
		t.Error("clean start must default on")
	}
	if config.KeepAlive != defaultKeepAlive {
		t.Errorf("keep alive = %v, want %v", config.KeepAlive, defaultKeepAlive)
	}
	if config.DialTimeout != defaultDialTimeout {
		t.Errorf("dial timeout = %v, want %v", config.DialTimeout, defaultDialTimeout)
	}
	if config.ClientID == "" {
		t.Error("no client id was generated")
	}
}

/*
 * The connection service fills in RocketMQ's global access keys and sets the
 * mechanism to acl on any profile that has none of its own, because that is
 * the one credential it knows how to supply for everybody. An MQTT profile
 * arrives at Open carrying them.
 *
 * Reading them as a username and password would send the user's RocketMQ
 * secret to their MQTT broker and fail to authenticate, so anything but plain
 * has to mean anonymous here. Kafka and RabbitMQ ignore them the same way; see
 * internal/service/connection/lifecycle.go.
 */
func TestConfigOfIgnoresCredentialsMeantForAnotherFamily(t *testing.T) {
	config, err := configOf(model.ConnectionProfile{
		Kind:      model.KindMQTT,
		Endpoints: "broker.internal:1883",
		Auth:      model.AuthConfig{Mechanism: model.AuthACL},
		Secrets: map[string]string{
			model.SecretAccessKey: "rocketmq-access-key",
			model.SecretSecretKey: "rocketmq-secret-key",
		},
	})
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}

	if config.Authenticates {
		t.Error("an acl profile authenticates, but MQTT has no such mechanism")
	}
	if config.Username != "" || config.Password != "" {
		t.Errorf("another family's credentials reached the broker: %q / %q",
			config.Username, config.Password)
	}
}

func TestConfigOfBuildsATLSConfigOnlyForTheEncryptedTransports(t *testing.T) {
	tests := []struct {
		transport string
		wantTLS   bool
	}{
		{transport: transportTCP},
		{transport: transportWS},
		{transport: transportTLS, wantTLS: true},
		{transport: transportWSS, wantTLS: true},
	}

	for _, test := range tests {
		t.Run(test.transport, func(t *testing.T) {
			config, err := configOf(model.ConnectionProfile{
				Kind:      model.KindMQTT,
				Endpoints: "broker.internal",
				Options: map[string]string{
					OptionTransport:     test.transport,
					OptionTLSSkipVerify: "true",
				},
			})
			if err != nil {
				t.Fatalf("configOf: %v", err)
			}

			if (config.TLS != nil) != test.wantTLS {
				t.Fatalf("TLS config present = %v, want %v", config.TLS != nil, test.wantTLS)
			}
			if test.wantTLS && !config.TLS.InsecureSkipVerify {
				t.Error("skip-verify was asked for and did not reach the TLS config")
			}
		})
	}
}
