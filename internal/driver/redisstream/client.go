package redisstream

import (
	"crypto/tls"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

const (
	defaultPort        = "6379"
	defaultDialTimeout = 5 * time.Second

	// clientName is what CLIENT SETNAME records, so an operator reading
	// CLIENT LIST can tell this app apart from their own services. The
	// client-connections page shows the column, and every row saying
	// "unnamed" would make it useless.
	clientName = "mq-studio"
)

// Deployment is how a profile reaches Redis.
//
// It is a stored option rather than something guessed from the address,
// because the three cannot be told apart by looking: one host:port is a
// standalone server, a sentinel, or a cluster's configuration endpoint, and
// only the person who set it up knows which.
type Deployment string

const (
	DeploymentStandalone Deployment = "standalone"
	DeploymentSentinel   Deployment = "sentinel"
	DeploymentCluster    Deployment = "cluster"
)

// clientConfig is one connection profile read into what go-redis needs.
//
// A plain struct with no profile in it, so the derivation can be tested on its
// own. Getting the deployment wrong is not a visible error - it is a client
// that talks to the wrong thing and fails later, somewhere else.
type clientConfig struct {
	Deployment    Deployment
	Addrs         []string
	MasterName    string
	DB            int
	Username      string
	Password      string
	TLS           bool
	TLSSkipVerify bool
	// StreamFilter is the SCAN MATCH pattern the destination listing uses.
	// Empty means every stream in the database.
	StreamFilter string
	ClientName   string
	DialTimeout  time.Duration
}

// configOf reads a profile into dial parameters.
func configOf(profile model.ConnectionProfile) (clientConfig, error) {
	deployment := deploymentOf(profile.Option(OptionDeployment))
	addrs, err := parseAddrs(profile.Endpoints)
	if err != nil {
		return clientConfig{}, err
	}
	// A standalone client is one server. go-redis picks a cluster client the
	// moment it is handed more than one address, so a second address here
	// would silently change what this profile is - see universalOptions.
	if deployment == DeploymentStandalone && len(addrs) > 1 {
		return clientConfig{}, fmt.Errorf(
			"a standalone connection takes one address, got %d; choose the cluster or sentinel mode instead",
			len(addrs))
	}

	db, err := parseDB(profile.Option(OptionDB))
	if err != nil {
		return clientConfig{}, err
	}
	masterName := strings.TrimSpace(profile.Option(OptionMasterName))
	if deployment == DeploymentSentinel && masterName == "" {
		return clientConfig{}, fmt.Errorf("a sentinel connection needs the master name to ask for")
	}

	config := clientConfig{
		Deployment:    deployment,
		Addrs:         addrs,
		MasterName:    masterName,
		DB:            db,
		Username:      profile.Secret(SecretUsername),
		Password:      profile.Secret(SecretPassword),
		TLS:           profile.Option(OptionTLS) == "true",
		TLSSkipVerify: profile.Option(OptionTLSSkipVerify) == "true",
		StreamFilter:  strings.TrimSpace(profile.Option(OptionStreamFilter)),
		ClientName:    connectionName(profile.Name),
		DialTimeout:   defaultDialTimeout,
	}
	if profile.TimeoutSec > 0 {
		config.DialTimeout = time.Duration(profile.TimeoutSec) * time.Second
	}
	return config, nil
}

// deploymentOf defaults to standalone, which is what an unset option means: a
// profile saved before this field existed, or a form the user did not touch.
func deploymentOf(raw string) Deployment {
	switch Deployment(strings.TrimSpace(raw)) {
	case DeploymentSentinel:
		return DeploymentSentinel
	case DeploymentCluster:
		return DeploymentCluster
	default:
		return DeploymentStandalone
	}
}

// parseDB reads the database index. Empty is 0, which is Redis's own default
// and the only database a cluster has.
func parseDB(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	db, err := strconv.Atoi(raw)
	if err != nil || db < 0 {
		return 0, fmt.Errorf("invalid database index %q", raw)
	}
	return db, nil
}

// parseAddrs turns the address field into host:port pairs go-redis will dial.
//
// The form collects a list for the cluster and sentinel modes, and people
// paste it in every shape a config file allows, so commas, semicolons and
// whitespace all separate. A redis:// or rediss:// scheme is stripped rather
// than refused: Redis has a URL form, users paste it, and the part that
// matters is the same either way. A bare host gets the default port, because a
// host with no port is a server they meant to name rather than a mistake.
func parseAddrs(raw string) ([]string, error) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})

	addrs := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		addr, err := normaliseAddr(field)
		if err != nil {
			return nil, err
		}
		if seen[addr] {
			continue
		}
		seen[addr] = true
		addrs = append(addrs, addr)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("the redis address cannot be empty")
	}
	return addrs, nil
}

func normaliseAddr(raw string) (string, error) {
	addr := strings.TrimSpace(raw)
	if scheme := strings.Index(addr, "://"); scheme >= 0 {
		addr = addr[scheme+len("://"):]
	}
	// A redis URL may carry credentials and a database path. Both are
	// collected by their own fields on the form, and taking them from the
	// address too would leave two sources disagreeing.
	if at := strings.LastIndex(addr, "@"); at >= 0 {
		addr = addr[at+1:]
	}
	if slash := strings.Index(addr, "/"); slash >= 0 {
		addr = addr[:slash]
	}
	if addr == "" {
		return "", fmt.Errorf("the redis address cannot be empty")
	}

	if _, _, err := net.SplitHostPort(addr); err == nil {
		return addr, nil
	}
	// A bare IPv6 address has to be bracketed before a port can be appended,
	// or host:port parsing reads its last group as the port.
	if strings.Count(addr, ":") > 1 && !strings.HasPrefix(addr, "[") {
		addr = "[" + addr + "]"
	}
	withPort := net.JoinHostPort(strings.Trim(addr, "[]"), defaultPort)
	if _, _, err := net.SplitHostPort(withPort); err != nil {
		return "", fmt.Errorf("invalid redis address %q", raw)
	}
	return withPort, nil
}

// connectionName names the profile in CLIENT LIST, so an operator with several
// open can tell which one is asking.
func connectionName(profile string) string {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return clientName
	}
	// Redis rejects a client name containing a space or a newline, and profile
	// names are free text, so anything outside the safe set becomes a dash
	// rather than a failed CLIENT SETNAME on every connection in the pool.
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

/*
 * universalOptions is the go-redis configuration one profile produces.
 *
 * The whole reason this driver speaks to three deployments through one client
 * is that NewUniversalClient picks the implementation from these fields. What
 * it picks is not obvious, and getting it wrong is silent:
 *
 *   - MasterName set   -> a failover client, which asks sentinels for the
 *                         master and connects to that.
 *   - IsClusterMode or
 *     more than one
 *     address          -> a cluster client, which follows MOVED redirects.
 *   - otherwise        -> a plain client.
 *
 * Two consequences are load-bearing. IsClusterMode is set explicitly rather
 * than relying on the address count, because a cluster is very often reached
 * through a single configuration endpoint and would otherwise be dialled as a
 * standalone server that answers MOVED to half the keyspace. And a standalone
 * profile is refused more than one address in configOf, because the same rule
 * would turn it into a cluster client without saying so.
 *
 * DB is left at zero for a cluster: Redis Cluster has one database, and SELECT
 * is refused there.
 */
func universalOptions(config clientConfig) *redis.UniversalOptions {
	options := &redis.UniversalOptions{
		Addrs:       config.Addrs,
		ClientName:  config.ClientName,
		Username:    config.Username,
		Password:    config.Password,
		DialTimeout: config.DialTimeout,
		TLSConfig:   tlsConfigFor(config),
	}

	switch config.Deployment {
	case DeploymentCluster:
		options.IsClusterMode = true
	case DeploymentSentinel:
		options.MasterName = config.MasterName
		options.DB = config.DB
		// The sentinels and the master usually share a credential, and where
		// they do not the form has no second pair to collect. Passing the
		// same one is what makes an authenticated sentinel reachable at all;
		// a deployment that separates them needs a field this form does not
		// have yet, and will say so by failing to authenticate.
		options.SentinelUsername = config.Username
		options.SentinelPassword = config.Password
	default:
		options.DB = config.DB
	}
	return options
}

// tlsConfigFor is nil unless the profile asked for TLS, which leaves the dial
// on plaintext rather than an empty config that would change how it behaves.
func tlsConfigFor(config clientConfig) *tls.Config {
	if !config.TLS {
		return nil
	}
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		// Opt-in, and named for what it does. Self-signed certificates are
		// common on internal deployments; silently accepting them would not be.
		InsecureSkipVerify: config.TLSSkipVerify,
	}
}

// newClient dials nothing. go-redis connects lazily on the first command, so a
// bad address surfaces from Ping rather than here - which is what lets the
// capability probe classify the failure instead of the caller seeing a raw
// dial error.
func newClient(config clientConfig) redis.UniversalClient {
	return redis.NewUniversalClient(universalOptions(config))
}
