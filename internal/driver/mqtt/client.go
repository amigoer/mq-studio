package mqtt

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

const (
	// The default port per transport. 1883 and 8883 are IANA-assigned; the two
	// WebSocket ports are only a convention (EMQX's), and Mosquitto's own
	// example config uses 9001 — so those two are a starting point rather
	// than an answer, and the form asks for a port.
	defaultPortTCP = "1883"
	defaultPortTLS = "8883"
	defaultPortWS  = "8083"
	defaultPortWSS = "8084"

	// clientName prefixes the MQTT client id, so an operator reading the
	// broker's client list can tell this app apart from their own services.
	clientName = "mq-studio"

	defaultDialTimeout = 5 * time.Second
	defaultKeepAlive   = 60 * time.Second

	// pingFilter is a topic filter this driver never subscribes to.
	//
	// Ping unsubscribes from it, which sounds odd and is deliberate: MQTT has
	// no request that reads broker state, so the only ways to prove the
	// session is alive are to publish something, to subscribe to something, or
	// to unsubscribe from something. Only the last has no effect a second
	// client could observe — the broker answers UNSUBACK ("no subscription
	// existed" under 5.0) and nothing changes anywhere.
	pingFilter = clientName + "/probe"
)

// clientConfig is one connection profile read into what a client needs.
//
// It is a plain struct with no profile in it so the derivation can be tested
// on its own: getting the transport, the port or the credential wrong is a
// connection that fails for a reason the user cannot see.
type clientConfig struct {
	Servers       []*url.URL
	ProtocolV5    bool
	ClientID      string
	Username      string
	Password      string
	Authenticates bool
	KeepAlive     time.Duration
	CleanStart    bool
	SessionExpiry uint32
	TLS           *tls.Config
	DialTimeout   time.Duration
}

// configOf reads a profile into dial parameters.
func configOf(profile model.ConnectionProfile) (clientConfig, error) {
	transport := profile.Option(OptionTransport)
	if transport == "" {
		transport = transportTCP
	}
	servers, err := serverURLs(profile.Endpoints, transport, profile.Option(OptionWebSocketPath))
	if err != nil {
		return clientConfig{}, err
	}
	tlsConfig, err := tlsConfigFor(transport, profile)
	if err != nil {
		return clientConfig{}, err
	}

	// AuthACL is what the connection service stamps on a profile that has no
	// mechanism of its own, because RocketMQ's access keys are the one
	// credential it knows how to fill in globally. MQTT has no such concept,
	// so anything but plain means anonymous rather than an error.
	authenticates := profile.Auth.Mechanism == model.AuthPlain

	config := clientConfig{
		Servers:       servers,
		ProtocolV5:    profile.Option(OptionProtocolVersion) != protocol311,
		ClientID:      clientID(profile.Option(OptionClientID)),
		Authenticates: authenticates,
		KeepAlive:     defaultKeepAlive,
		// MQTT's own default is a resumable session; this app's is not. A
		// console that resumed would inherit whatever subscriptions the last
		// window left behind and start receiving traffic nobody asked for.
		CleanStart:  profile.Option(OptionCleanStart) != "false",
		TLS:         tlsConfig,
		DialTimeout: defaultDialTimeout,
	}
	if authenticates {
		config.Username = profile.Secret(SecretUsername)
		config.Password = profile.Secret(SecretPassword)
	}
	if seconds, err := positiveInt(profile.Option(OptionKeepAliveSec)); err == nil {
		config.KeepAlive = time.Duration(seconds) * time.Second
	}
	if seconds, err := positiveInt(profile.Option(OptionSessionExpiry)); err == nil {
		config.SessionExpiry = uint32(seconds)
	}
	if profile.TimeoutSec > 0 {
		config.DialTimeout = time.Duration(profile.TimeoutSec) * time.Second
	}
	return config, nil
}

// serverURLs turns the address field into URLs both client libraries dial.
//
// The field collects host:port and nothing else. A scheme is stripped rather
// than honoured, and so is a path: people paste "mqtt://host:1883" and
// "ws://host:8083/mqtt" out of habit, and letting either override the
// transport chosen on the form would leave two places deciding one thing.
// The form is the one that decides.
func serverURLs(raw, transport, wsPath string) ([]*url.URL, error) {
	scheme, port, err := transportScheme(transport)
	if err != nil {
		return nil, err
	}
	path := ""
	if scheme == "ws" || scheme == "wss" {
		path = normaliseWebSocketPath(wsPath)
	}

	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})

	servers := make([]*url.URL, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		host, err := normaliseHost(field, port)
		if err != nil {
			return nil, err
		}
		if seen[host] {
			continue
		}
		seen[host] = true
		servers = append(servers, &url.URL{Scheme: scheme, Host: host, Path: path})
	}
	if len(servers) == 0 {
		return nil, fmt.Errorf("broker address cannot be empty")
	}
	return servers, nil
}

// transportScheme maps the form's transport onto a URL scheme both libraries
// understand, and onto the port a bare host gets.
func transportScheme(transport string) (scheme, port string, err error) {
	switch transport {
	case "", transportTCP:
		return "mqtt", defaultPortTCP, nil
	case transportTLS:
		return "mqtts", defaultPortTLS, nil
	case transportWS:
		return "ws", defaultPortWS, nil
	case transportWSS:
		return "wss", defaultPortWSS, nil
	default:
		return "", "", fmt.Errorf("unsupported transport %q", transport)
	}
}

// normaliseHost strips a pasted scheme and path, and appends the transport's
// port when the address carries none.
func normaliseHost(raw, defaultPort string) (string, error) {
	host := strings.TrimSpace(raw)
	if scheme := strings.Index(host, "://"); scheme >= 0 {
		host = host[scheme+len("://"):]
	}
	if slash := strings.IndexByte(host, '/'); slash >= 0 {
		host = host[:slash]
	}
	if host == "" {
		return "", fmt.Errorf("broker address cannot be empty")
	}

	if _, _, err := net.SplitHostPort(host); err == nil {
		return host, nil
	}
	// A bare IPv6 address has to be bracketed before a port can be appended,
	// or host:port parsing reads its last group as the port.
	if strings.Count(host, ":") > 1 && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	withPort := net.JoinHostPort(strings.Trim(host, "[]"), defaultPort)
	if _, _, err := net.SplitHostPort(withPort); err != nil {
		return "", fmt.Errorf("invalid broker address %q", raw)
	}
	return withPort, nil
}

// normaliseWebSocketPath keeps the leading slash a URL needs. An empty path is
// left empty: some brokers serve MQTT at the root and a forced "/mqtt" would
// 404 against them.
func normaliseWebSocketPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		return "/" + path
	}
	return path
}

// clientID is an identity on the broker rather than a label: two connections
// sharing one take turns disconnecting each other, which reads as an unstable
// network. So an unset field gets a value unique to this connection instead of
// a constant, and a set one is passed through untouched — the user chose it
// because their broker's access rules match on it.
func clientID(configured string) string {
	if configured = strings.TrimSpace(configured); configured != "" {
		return configured
	}
	suffix := make([]byte, 4)
	if _, err := rand.Read(suffix); err != nil {
		// Only reachable if the system entropy source fails, and a fixed id
		// still connects — it just cannot share a broker with a second window.
		return clientName
	}
	return clientName + "-" + hex.EncodeToString(suffix)
}

// tlsConfigFor is nil on the plaintext transports, which leaves the dial
// unencrypted rather than handing the library an empty config.
func tlsConfigFor(transport string, profile model.ConnectionProfile) (*tls.Config, error) {
	if transport != transportTLS && transport != transportWSS {
		return nil, nil
	}
	settings := &tls.Config{
		MinVersion: tls.VersionTLS12,
		// Opt-in, and named for what it does. Self-signed certificates are
		// common on internal brokers; silently accepting them would not be.
		InsecureSkipVerify: profile.Option(OptionTLSSkipVerify) == "true",
	}
	caFile := strings.TrimSpace(profile.Option(OptionTLSCAFile))
	if caFile == "" {
		return settings, nil
	}

	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("read CA certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA certificate %q contains no certificate", caFile)
	}
	settings.RootCAs = pool
	return settings, nil
}

// positiveInt reads an option that only means something above zero, so an
// empty or malformed field falls back to the default rather than to nothing.
func positiveInt(raw string) (int, error) {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, err
	}
	if value <= 0 {
		return 0, fmt.Errorf("not a positive value: %d", value)
	}
	return value, nil
}

// mqttClient is the half of an MQTT client this driver needs, with one
// implementation per protocol version.
//
// It exists because Paho ships two Go libraries that do not overlap:
// paho.golang speaks 5.0 and paho.mqtt.golang speaks 3.1.1, and their APIs
// have nothing in common. Keeping the seam here rather than in
// internal/driver/ports.go is deliberate — no other family has this split, and
// widening a shared port for it would export one library's shape to everyone.
type mqttClient interface {
	// Connect performs CONNECT and blocks until the broker answers or ctx
	// ends. A refusal is returned, not retried.
	Connect(ctx context.Context) error

	// Ping proves the session is still live, over the wire.
	Ping(ctx context.Context) error

	// Publish sends one message. The answer is nil at QoS 0, where there is
	// nothing for the broker to say.
	Publish(ctx context.Context, request PublishRequest) (*publishAnswer, error)

	// Subscribe adds filters to the session.
	Subscribe(ctx context.Context, filters []subscribeFilter) error

	// Unsubscribe drops them again. The broker holds a subscription until it
	// is told otherwise, so this is not optional cleanup.
	Unsubscribe(ctx context.Context, patterns []string) error

	// OnMessage installs the single handler every delivery goes to. It is set
	// before Connect, because a subscription resumed on connect can deliver
	// before the call that established it returns.
	OnMessage(handler func(inboundMessage))

	// OnConnectionUp is called after every successful connect, reconnects
	// included, and returns the filters to re-establish. Both libraries are
	// configured for a clean session, which keeps none, so without this a
	// dropped connection comes back silent - the worst failure a live
	// workbench has, because it looks exactly like a quiet broker.
	OnConnectionUp(handler func() []subscribeFilter)

	// OnConnectionDown is called when the session drops, so a stream can say
	// it stopped listening rather than let the page read it as silence.
	OnConnectionDown(handler func())

	// Disconnect closes the session. It tolerates being called more than once
	// and being called after a failed Connect.
	Disconnect() error
}

// subscribeFilter is one topic filter to subscribe at a QoS.
type subscribeFilter struct {
	Pattern string
	QoS     byte
}

// inboundMessage is one delivery, in the shape both libraries can produce.
// Everything below Retained is 5.0 only and stays empty under 3.1.1.
type inboundMessage struct {
	Topic    string
	Payload  []byte
	QoS      byte
	Retained bool

	ContentType     string
	ResponseTopic   string
	CorrelationData string
	MessageExpiry   uint32
	UserProperties  map[string]string
}

// publishAnswer is what a broker said about one publish, in the shape both
// libraries can produce. A 3.1.1 broker fills in nothing at all: PUBACK
// carries no reason code before 5.0, so "accepted" is the whole answer.
type publishAnswer struct {
	ReasonCode            int
	Reason                string
	NoMatchingSubscribers bool
}

// newClient builds the client the profile's protocol version calls for.
// Nothing is dialled yet; Connect does that.
func newClient(config clientConfig) (mqttClient, error) {
	if config.ProtocolV5 {
		return newClientV5(config)
	}
	return newClientV311(config)
}
