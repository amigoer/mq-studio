package pulsar

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"
	pulsarlog "github.com/apache/pulsar-client-go/pulsar/log"
	pulsaradmin "github.com/apache/pulsar-client-go/pulsaradmin/pkg/admin"
	adminauth "github.com/apache/pulsar-client-go/pulsaradmin/pkg/admin/auth"
	adminconfig "github.com/apache/pulsar-client-go/pulsaradmin/pkg/admin/config"

	"github.com/amigoer/mq-studio/internal/model"
)

const defaultDialTimeout = 5 * time.Second

// clientConfig is one profile reduced to what the two planes need.
//
// It is a value rather than the profile itself so that nothing downstream can
// reach the secrets again: the token is read once, here, and everything after
// this point works from a config that has already been validated.
type clientConfig struct {
	// ServiceURL is the binary protocol address, pulsar:// or pulsar+ssl://.
	ServiceURL string
	// AdminURL is the web service address, http:// or https://.
	AdminURL  string
	Tenant    string
	Namespace string
	Token     string
	Timeout   time.Duration
	TLS       bool
	TLSCAFile string
	// TLSSkipVerify is opt-in and named for what it does. Self-signed
	// certificates are common on internal clusters; silently accepting them
	// would not be.
	TLSSkipVerify bool
}

// configOf reads a profile into a config, rejecting what cannot be dialled.
func configOf(profile model.ConnectionProfile) (clientConfig, error) {
	service, err := normaliseServiceURL(profile.Endpoints)
	if err != nil {
		return clientConfig{}, err
	}
	admin, err := normaliseAdminURL(profile.Option(OptionAdminURL))
	if err != nil {
		return clientConfig{}, err
	}

	config := clientConfig{
		ServiceURL:    service,
		AdminURL:      admin,
		Tenant:        valueOr(profile.Option(OptionTenant), defaultTenant),
		Namespace:     valueOr(profile.Option(OptionNamespace), defaultNamespace),
		Timeout:       timeoutOf(profile),
		TLS:           profile.Option(OptionTLS) == "true",
		TLSCAFile:     profile.Option(OptionTLSCAFile),
		TLSSkipVerify: profile.Option(OptionTLSSkipVerify) == "true",
	}
	// The token is the credential whether or not the mechanism says so: a
	// profile carrying one and set to "none" is a profile someone switched
	// off, and honouring the switch is what makes the control mean anything.
	if profile.Auth.Mechanism == model.AuthToken {
		config.Token = profile.Secret(SecretToken)
	}
	return config, nil
}

// normaliseServiceURL accepts a bare host or host:port as well as a full URL,
// because the form asks for an address and users type all three.
func normaliseServiceURL(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		return "", fmt.Errorf("pulsar service URL cannot be empty")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "pulsar://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid pulsar service URL %q: %w", raw, err)
	}
	switch parsed.Scheme {
	case "pulsar", "pulsar+ssl":
	default:
		return "", fmt.Errorf(
			"pulsar service URL %q must use pulsar:// or pulsar+ssl://, not %q://",
			raw, parsed.Scheme)
	}
	if parsed.Port() == "" {
		parsed.Host += ":" + defaultPort
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

// normaliseAdminURL is the same courtesy for the web service address, which is
// where every admin call goes.
func normaliseAdminURL(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		return "", fmt.Errorf("pulsar admin API address cannot be empty")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid pulsar admin API address %q: %w", raw, err)
	}
	switch parsed.Scheme {
	case "http", "https":
	default:
		return "", fmt.Errorf(
			"pulsar admin API address %q must use http:// or https://, not %q://",
			raw, parsed.Scheme)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("pulsar admin API address %q names no host", raw)
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

// timeoutOf is the profile's own timeout, which is what the connection form
// collects. It bounds reaching the host at all - something a request deadline
// cannot do on its own, because a host that never answers SYN consumes the
// whole budget before the first byte.
func timeoutOf(profile model.ConnectionProfile) time.Duration {
	if profile.TimeoutSec > 0 {
		return time.Duration(profile.TimeoutSec) * time.Second
	}
	return defaultDialTimeout
}

// newAdmin builds the admin REST client.
//
// The transport is ours rather than the library's. pulsaradmin builds its
// http.Client with a five-minute timeout and offers no way to set it, so a
// hung broker would block a board and the background collector for five
// minutes with nothing to show for it. Every call in this package uses a
// *WithContext variant, which is what actually bounds a request; installing
// this transport bounds the part a request deadline cannot - reaching the host
// and completing a TLS handshake.
//
// It is returned alongside the client because the client is an interface with
// no accessor for it, and closing a connection has to release its sockets.
func newAdmin(config clientConfig) (pulsaradmin.Client, http.RoundTripper, error) {
	adminCfg := &adminconfig.Config{
		WebServiceURL:              config.AdminURL,
		PulsarAPIVersion:           adminconfig.V2,
		Token:                      config.Token,
		TLSTrustCertsFilePath:      config.TLSCAFile,
		TLSAllowInsecureConnection: config.TLSSkipVerify,
	}
	provider, err := adminauth.GetAuthProvider(adminCfg)
	if err != nil {
		return nil, nil, fmt.Errorf("configure pulsar admin authentication: %w", err)
	}
	transport := newTransport(config)
	provider.WithTransport(transport)

	client, err := pulsaradmin.NewPulsarClientWithAuthProvider(adminCfg, provider)
	if err != nil {
		return nil, nil, fmt.Errorf("build the pulsar admin client: %w", err)
	}
	return client, transport, nil
}

// newTransport is the HTTP transport one connection's admin calls share.
//
// It exists per connection rather than per process because it carries that
// profile's timeout and TLS settings: two profiles against one cluster need
// not agree on either.
func newTransport(config clientConfig) http.RoundTripper {
	return &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: config.Timeout, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig:     tlsConfigFor(config),
		TLSHandshakeTimeout: config.Timeout,
		MaxIdleConns:        8,
		IdleConnTimeout:     60 * time.Second,
	}
}

// tlsConfigFor is nil unless the profile asked for TLS, which leaves the
// transport on its own defaults rather than an empty config that would change
// how a plaintext connection behaves.
func tlsConfigFor(config clientConfig) *tls.Config {
	if !config.TLS {
		return nil
	}
	return &tls.Config{InsecureSkipVerify: config.TLSSkipVerify}
}

// newDataPlane builds the binary protocol client.
//
// Creating it does not dial: pulsar-client-go connects lazily, on the first
// producer or reader. That is why probe pings the data plane explicitly rather
// than treating a successful New as proof of anything.
func newDataPlane(config clientConfig) (pulsarclient.Client, error) {
	options := pulsarclient.ClientOptions{
		URL:               config.ServiceURL,
		ConnectionTimeout: config.Timeout,
		OperationTimeout:  config.Timeout,
		// The library logs every lookup and reconnection at info through
		// logrus, which in a desktop app is output nobody asked for and
		// nobody reads. Errors reach the user as degrade reasons instead.
		Logger: pulsarlog.DefaultNopLogger(),
	}
	if config.Token != "" {
		options.Authentication = pulsarclient.NewAuthenticationToken(config.Token)
	}
	if config.TLS {
		options.TLSTrustCertsFilePath = config.TLSCAFile
		options.TLSAllowInsecureConnection = config.TLSSkipVerify
		options.TLSValidateHostname = !config.TLSSkipVerify
	}

	client, err := pulsarclient.NewClient(options)
	if err != nil {
		return nil, fmt.Errorf("build the pulsar client: %w", err)
	}
	return client, nil
}
