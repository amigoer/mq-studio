package nats

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	natsclient "github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"

	"github.com/amigoer/mq-studio/internal/model"
)

const (
	defaultPort        = "4222"
	defaultDialTimeout = 5 * time.Second
	// clientName is what /connz and the connections board show this app as.
	// A NATS connection has no other identity, so it is the only way an
	// operator can tell mq-studio's sockets from an application's.
	clientName = "mq-studio"
)

// clientConfig is one profile reduced to what the connections need.
//
// A value rather than the profile, so nothing downstream can reach the
// secrets again: they are read once, here, and everything after this point
// works from a config that has already been validated.
type clientConfig struct {
	// Servers are nats:// URLs. All of them are handed to the client, which
	// picks one and keeps the rest for reconnects.
	Servers []string

	Mechanism model.AuthMechanism
	Username  string
	Password  string
	Token     string
	// NKeySeed is the seed itself rather than a path to it. The library's own
	// option reads a file; this app already encrypts secrets at rest, and a
	// path would put the one thing worth protecting outside that.
	NKeySeed string
	// CredsFile is a path, because a creds file carries a JWT as well as a
	// seed and the library reads both out of the file itself.
	CredsFile string

	TLS         bool
	TLSCAFile   string
	TLSCertFile string
	TLSKeyFile  string
	// TLSSkipVerify is opt-in and named for what it does. Self-signed
	// certificates are ordinary on internal clusters; silently accepting them
	// would not be.
	TLSSkipVerify bool

	// MonitorURL is the server's HTTP monitoring endpoint, and empty is the
	// ordinary case rather than a failure: it is off unless the operator
	// started the server with -m.
	MonitorURL string

	// SystemUser and SystemPassword reach the system account, which is a
	// separate account and therefore a separate connection. Empty means the
	// cluster-wide questions go unasked.
	SystemUser     string
	SystemPassword string

	// JSDomain scopes the JetStream API subject. Empty is the default domain,
	// which is what every cluster that has not been split by a leaf node uses.
	JSDomain string

	DialTimeout time.Duration
}

// configOf reads a profile into dial parameters, rejecting what cannot be
// dialled.
func configOf(profile model.ConnectionProfile) (clientConfig, error) {
	servers, err := parseServers(profile.Endpoints)
	if err != nil {
		return clientConfig{}, err
	}
	monitor, err := normaliseMonitorURL(profile.Option(OptionMonitorURL))
	if err != nil {
		return clientConfig{}, err
	}

	config := clientConfig{
		Servers:        servers,
		Mechanism:      profile.Auth.Mechanism,
		TLS:            profile.Option(OptionTLS) == "true",
		TLSCAFile:      strings.TrimSpace(profile.Option(OptionTLSCAFile)),
		TLSCertFile:    strings.TrimSpace(profile.Option(OptionTLSCertFile)),
		TLSKeyFile:     strings.TrimSpace(profile.Option(OptionTLSKeyFile)),
		TLSSkipVerify:  profile.Option(OptionTLSSkipVerify) == "true",
		MonitorURL:     monitor,
		SystemUser:     profile.Secret(SecretSystemUser),
		SystemPassword: profile.Secret(SecretSystemPassword),
		JSDomain:       strings.TrimSpace(profile.Option(OptionJSDomain)),
		DialTimeout:    defaultDialTimeout,
	}

	// Each credential is read only under the mechanism that uses it. A
	// profile carrying a token and set to "none" is one somebody switched
	// off, and honouring the switch is what makes the control mean anything.
	switch profile.Auth.Mechanism {
	case model.AuthPlain:
		config.Username = profile.Secret(SecretUsername)
		config.Password = profile.Secret(SecretPassword)
	case model.AuthToken:
		config.Token = profile.Secret(SecretToken)
	case model.AuthNKey:
		config.NKeySeed = strings.TrimSpace(profile.Secret(SecretNKeySeed))
	case model.AuthCreds:
		config.CredsFile = strings.TrimSpace(profile.Option(OptionCredsFile))
	}

	if profile.TimeoutSec > 0 {
		config.DialTimeout = time.Duration(profile.TimeoutSec) * time.Second
	}
	return config, nil
}

// parseServers turns the address field into URLs the client will dial.
//
// The form collects a list and people paste it in every shape a NATS config
// allows, so commas, semicolons and whitespace all separate. A bare host gets
// the default port: an address with no port is not an error a user would
// recognise, it is a server they meant to name.
func parseServers(raw string) ([]string, error) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})

	servers := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		server, err := normaliseServer(field)
		if err != nil {
			return nil, err
		}
		if seen[server] {
			continue
		}
		seen[server] = true
		servers = append(servers, server)
	}
	if len(servers) == 0 {
		return nil, fmt.Errorf("nats server address cannot be empty")
	}
	return servers, nil
}

// natsSchemes are the ones the client understands. Anything else is a typo
// worth naming rather than a transport to attempt.
var natsSchemes = map[string]bool{"nats": true, "tls": true, "ws": true, "wss": true}

func normaliseServer(raw string) (string, error) {
	server := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "/"))
	if server == "" {
		return "", fmt.Errorf("nats server address cannot be empty")
	}
	if !strings.Contains(server, "://") {
		server = "nats://" + server
	}
	parsed, err := url.Parse(server)
	if err != nil {
		return "", fmt.Errorf("%q is not a valid nats address: %w", raw, err)
	}
	if !natsSchemes[parsed.Scheme] {
		return "", fmt.Errorf("%q is not a nats address: scheme must be nats, tls, ws or wss", raw)
	}
	if parsed.Hostname() == "" {
		return "", fmt.Errorf("%q names no host", raw)
	}
	// Only the plain protocol has a default worth guessing. A WebSocket
	// endpoint is served on whatever port the operator put it on, and there
	// is no convention to fall back to.
	if parsed.Port() == "" && (parsed.Scheme == "nats" || parsed.Scheme == "tls") {
		parsed.Host = parsed.Host + ":" + defaultPort
	}
	return parsed.String(), nil
}

// normaliseMonitorURL accepts a bare host or host:port as well as a full URL,
// because the form asks for an address and people type all three. Empty stays
// empty: the endpoint is optional.
func normaliseMonitorURL(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		return "", nil
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("%q is not a valid monitoring URL: %w", raw, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("the monitoring endpoint is served over http; %q is not", raw)
	}
	if parsed.Hostname() == "" {
		return "", fmt.Errorf("%q names no host", raw)
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

// dialOptions turns the config into what nats.Connect takes.
//
// suffix distinguishes the two connections one profile opens - the account's
// and the system account's - in /connz, where a name is all there is to tell
// them apart.
func (c clientConfig) dialOptions(suffix string) ([]natsclient.Option, error) {
	name := clientName
	if suffix != "" {
		name += "-" + suffix
	}
	options := []natsclient.Option{
		natsclient.Name(name),
		natsclient.Timeout(c.DialTimeout),
		// Keep trying. Every page here reads through this connection, and a
		// client that gave up after a blip would leave the whole app dead
		// until the user reconnected by hand.
		natsclient.MaxReconnects(-1),
		natsclient.RetryOnFailedConnect(false),
	}

	tlsConfig, err := c.tlsConfig()
	if err != nil {
		return nil, err
	}
	if tlsConfig != nil {
		options = append(options, natsclient.Secure(tlsConfig))
	}

	auth, err := c.authOption()
	if err != nil {
		return nil, err
	}
	if auth != nil {
		options = append(options, auth)
	}
	return options, nil
}

// systemDialOptions is the same connection with the system account's
// credentials substituted for the profile's own.
//
// The credentials cannot be shared: an account is an isolation boundary, so
// $SYS.REQ.* is unreachable from the account the app's pages read through, and
// reaching it means a second connection rather than a second subject.
func (c clientConfig) systemDialOptions() ([]natsclient.Option, error) {
	system := c
	system.Mechanism = model.AuthPlain
	system.Username = c.SystemUser
	system.Password = c.SystemPassword
	system.Token = ""
	system.NKeySeed = ""
	system.CredsFile = ""
	return system.dialOptions("system")
}

func (c clientConfig) authOption() (natsclient.Option, error) {
	switch c.Mechanism {
	case model.AuthPlain:
		if c.Username == "" {
			return nil, nil
		}
		return natsclient.UserInfo(c.Username, c.Password), nil
	case model.AuthToken:
		if c.Token == "" {
			return nil, fmt.Errorf("token authentication needs a token")
		}
		return natsclient.Token(c.Token), nil
	case model.AuthNKey:
		return nkeyOption(c.NKeySeed)
	case model.AuthCreds:
		if c.CredsFile == "" {
			return nil, fmt.Errorf("credentials-file authentication needs a path")
		}
		if _, err := os.Stat(c.CredsFile); err != nil {
			return nil, fmt.Errorf("cannot read the credentials file: %w", err)
		}
		return natsclient.UserCredentials(c.CredsFile), nil
	default:
		return nil, nil
	}
}

// nkeyOption signs the server's nonce with a seed held in memory.
//
// nats.NkeyOptionFromSeed reads a file, and a file is the wrong place for
// this: the seed is the whole credential, the app already encrypts what it
// stores, and pointing at a path would put it back on disk in the clear.
func nkeyOption(seed string) (natsclient.Option, error) {
	if seed == "" {
		return nil, fmt.Errorf("nkey authentication needs a seed")
	}
	pair, err := nkeys.FromSeed([]byte(seed))
	if err != nil {
		return nil, fmt.Errorf("that is not a valid nkey seed: %w", err)
	}
	public, err := pair.PublicKey()
	if err != nil {
		return nil, fmt.Errorf("that nkey seed has no public key: %w", err)
	}
	return natsclient.Nkey(public, func(nonce []byte) ([]byte, error) {
		// Signed per connection attempt rather than once, because the server
		// issues a fresh nonce on every reconnect.
		return pair.Sign(nonce)
	}), nil
}

func (c clientConfig) tlsConfig() (*tls.Config, error) {
	usesTLS := c.TLS || c.Mechanism == model.AuthMutualTLS
	for _, server := range c.Servers {
		if strings.HasPrefix(server, "tls://") || strings.HasPrefix(server, "wss://") {
			usesTLS = true
		}
	}
	if !usesTLS {
		return nil, nil
	}

	config := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.TLSSkipVerify} //nolint:gosec // opt-in, and the form says what it does
	if c.TLSCAFile != "" {
		pool, err := certPool(c.TLSCAFile)
		if err != nil {
			return nil, err
		}
		config.RootCAs = pool
	}
	// Both halves or neither: a certificate with no key cannot be presented,
	// and reporting that at dial time reads as a server refusing the
	// connection rather than as a form filled in half way.
	if (c.TLSCertFile == "") != (c.TLSKeyFile == "") {
		return nil, fmt.Errorf("a client certificate needs both the certificate and its key")
	}
	if c.TLSCertFile != "" {
		certificate, err := tls.LoadX509KeyPair(c.TLSCertFile, c.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("cannot read the client certificate: %w", err)
		}
		config.Certificates = []tls.Certificate{certificate}
	}
	return config, nil
}

// certPool reads a PEM bundle the operator pointed the form at.
func certPool(path string) (*x509.CertPool, error) {
	pem, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read the CA certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA certificate %q contains no certificate", path)
	}
	return pool, nil
}
