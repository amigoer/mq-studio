package kafka

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"

	"github.com/amigoer/mq-studio/internal/model"
)

const (
	defaultPort        = "9092"
	defaultDialTimeout = 5 * time.Second

	// clientName is what the broker records as the client id on every request.
	// An operator reading a broker log, a quota entry or a consumer group's
	// members should be able to tell this app apart from their own services.
	clientName = "mq-studio"

	// metadataMinAge is how stale the topology may be.
	//
	// kadm reads every listing through franz-go's metadata cache, whose
	// default floor is five seconds. That is right for a producer and wrong
	// for a console: an operator who deletes a topic and sees it still listed
	// deletes it again. A hundred milliseconds is short enough that the round
	// trip between a mutation and the board's re-read cannot fit inside it,
	// and long enough that one page load's burst of calls still shares a
	// single metadata fetch.
	metadataMinAge = 100 * time.Millisecond
)

// clientConfig is one connection profile read into what franz-go needs.
//
// It is a plain struct with no profile in it so the derivation can be tested
// on its own: getting a bootstrap list, a SASL mechanism or a TLS config wrong
// is a connection that fails for a reason the user cannot see.
type clientConfig struct {
	Seeds         []string
	ClientID      string
	Mechanism     model.AuthMechanism
	SCRAMSHA      string
	Username      string
	Password      string
	TLS           bool
	TLSSkipVerify bool
	TLSCAFile     string
	DialTimeout   time.Duration
}

// configOf reads a profile into dial parameters.
func configOf(profile model.ConnectionProfile) (clientConfig, error) {
	seeds, err := parseSeeds(profile.Endpoints)
	if err != nil {
		return clientConfig{}, err
	}

	config := clientConfig{
		Seeds:         seeds,
		ClientID:      clientID(profile.Name),
		Mechanism:     profile.Auth.Mechanism,
		SCRAMSHA:      profile.Option(OptionSCRAMSHA),
		Username:      profile.Secret(SecretUsername),
		Password:      profile.Secret(SecretPassword),
		TLS:           profile.Option(OptionTLS) == "true",
		TLSSkipVerify: profile.Option(OptionTLSSkipVerify) == "true",
		TLSCAFile:     strings.TrimSpace(profile.Option(OptionTLSCAFile)),
		DialTimeout:   defaultDialTimeout,
	}
	if profile.TimeoutSec > 0 {
		config.DialTimeout = time.Duration(profile.TimeoutSec) * time.Second
	}
	return config, nil
}

// parseSeeds turns the bootstrap field into addresses franz-go will dial.
//
// The form collects a list and users paste it in every shape a Kafka config
// file allows, so commas, semicolons, whitespace and newlines all separate.
// A bare host gets the default port: a seed with no port is not an error the
// user would recognise, it is a broker they meant to name.
func parseSeeds(raw string) ([]string, error) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})

	seeds := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		seed, err := normaliseSeed(field)
		if err != nil {
			return nil, err
		}
		if seen[seed] {
			continue
		}
		seen[seed] = true
		seeds = append(seeds, seed)
	}
	if len(seeds) == 0 {
		return nil, fmt.Errorf("bootstrap servers cannot be empty")
	}
	return seeds, nil
}

// normaliseSeed appends the default port and rejects anything that is not an
// address. A scheme is stripped rather than refused because Kafka has no URL
// form and people still paste one.
func normaliseSeed(raw string) (string, error) {
	seed := strings.TrimSpace(raw)
	if scheme := strings.Index(seed, "://"); scheme >= 0 {
		seed = seed[scheme+len("://"):]
	}
	seed = strings.TrimSuffix(seed, "/")
	if seed == "" {
		return "", fmt.Errorf("bootstrap servers cannot be empty")
	}

	if _, _, err := net.SplitHostPort(seed); err == nil {
		return seed, nil
	}
	// A bare IPv6 address has to be bracketed before a port can be appended,
	// or host:port parsing reads its last group as the port.
	if strings.Count(seed, ":") > 1 && !strings.HasPrefix(seed, "[") {
		seed = "[" + seed + "]"
	}
	withPort := net.JoinHostPort(strings.Trim(seed, "[]"), defaultPort)
	if _, _, err := net.SplitHostPort(withPort); err != nil {
		return "", fmt.Errorf("invalid bootstrap server %q", raw)
	}
	return withPort, nil
}

// clientID identifies this app to the broker, and names the profile so an
// operator with several of them open can tell which one is asking.
func clientID(profile string) string {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return clientName
	}
	// Kafka rejects a client id outside [A-Za-z0-9._-], and profile names are
	// free text, so anything else becomes a dash rather than a failed request.
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '.', r == '_', r == '-':
			return r
		default:
			return '-'
		}
	}, profile)
	return clientName + "." + cleaned
}

// saslMechanism is nil when the profile authenticates with nothing, which is
// how a plaintext development cluster is reached.
func saslMechanism(config clientConfig) (sasl.Mechanism, error) {
	switch config.Mechanism {
	case "", model.AuthNone:
		return nil, nil
	case model.AuthSASLPlain:
		return plain.Auth{User: config.Username, Pass: config.Password}.AsMechanism(), nil
	case model.AuthSASLScram:
		auth := scram.Auth{User: config.Username, Pass: config.Password}
		// Kafka's two SCRAM mechanisms are separate credentials on the broker,
		// not two encodings of one, so picking the wrong digest fails
		// authentication against a user that exists.
		switch config.SCRAMSHA {
		case "", scramSHA512:
			return auth.AsSha512Mechanism(), nil
		case scramSHA256:
			return auth.AsSha256Mechanism(), nil
		default:
			return nil, fmt.Errorf("unsupported SCRAM digest %q", config.SCRAMSHA)
		}
	default:
		return nil, fmt.Errorf("unsupported authentication mechanism %q", config.Mechanism)
	}
}

// tlsConfigFor is nil unless the profile asked for TLS, which leaves the dial
// on plaintext rather than an empty config that would change how it behaves.
func tlsConfigFor(config clientConfig) (*tls.Config, error) {
	if !config.TLS {
		return nil, nil
	}
	settings := &tls.Config{
		MinVersion: tls.VersionTLS12,
		// Opt-in, and named for what it does. Self-signed certificates are
		// common on internal clusters; silently accepting them would not be.
		InsecureSkipVerify: config.TLSSkipVerify,
	}
	if config.TLSCAFile == "" {
		return settings, nil
	}

	pem, err := os.ReadFile(config.TLSCAFile)
	if err != nil {
		return nil, fmt.Errorf("read CA certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA certificate %q contains no certificate", config.TLSCAFile)
	}
	settings.RootCAs = pool
	return settings, nil
}

// dialOptions is the franz-go configuration one profile produces.
func dialOptions(config clientConfig) ([]kgo.Opt, error) {
	mechanism, err := saslMechanism(config)
	if err != nil {
		return nil, err
	}
	tlsConfig, err := tlsConfigFor(config)
	if err != nil {
		return nil, err
	}

	options := []kgo.Opt{
		kgo.SeedBrokers(config.Seeds...),
		kgo.ClientID(config.ClientID),
		// Bounds reaching a host at all, which a request deadline cannot do on
		// its own: a broker that never answers SYN consumes the whole budget
		// before the first byte.
		kgo.DialTimeout(config.DialTimeout),
		kgo.MetadataMinAge(metadataMinAge),
	}
	if mechanism != nil {
		options = append(options, kgo.SASL(mechanism))
	}
	if tlsConfig != nil {
		options = append(options, kgo.DialTLSConfig(tlsConfig))
	}
	return options, nil
}

// newClient dials nothing. franz-go connects lazily on the first request, so
// a bad address surfaces from Ping rather than here - which is what lets the
// capability probe classify the failure instead of the caller seeing a raw
// dial error.
func newClient(config clientConfig) (*kgo.Client, *kadm.Client, error) {
	options, err := dialOptions(config)
	if err != nil {
		return nil, nil, err
	}
	client, err := kgo.NewClient(options...)
	if err != nil {
		return nil, nil, fmt.Errorf("build kafka client: %w", err)
	}
	return client, kadm.NewClient(client), nil
}
