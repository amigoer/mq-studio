// Package rabbitmq drives RabbitMQ through its HTTP management API.
//
// The management plugin is the whole admin plane. Without it a connection can
// publish and consume and nothing else, which is why the capability set is
// narrowed at connect time rather than assumed from the descriptor.
package rabbitmq

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
const (
	OptionVHost     = "vhost"
	SecretUsername  = "username"
	SecretPassword  = "password"
	defaultVHost    = "/"
	defaultMgmtPort = "15672"
)

// Driver is the RabbitMQ family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindRabbitMQ }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindRabbitMQ,
		DefaultPort:     defaultMgmtPort,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				Key:         "endpoints",
				Target:      model.TargetEndpoints,
				Type:        model.FieldText,
				LabelKey:    "mq.rabbitmq.form.managementUrl",
				Placeholder: "http://localhost:15672",
				Required:    true,
				Validate:    "url",
			},
			{
				Key:      OptionVHost,
				Target:   model.TargetOption,
				Type:     model.FieldText,
				LabelKey: "mq.rabbitmq.form.vhost",
				Default:  defaultVHost,
			},
			{
				Key:      "timeoutSec",
				Target:   model.TargetOption,
				Type:     model.FieldNumber,
				LabelKey: "mq.common.form.timeoutSec",
				Default:  "5",
				Validate: "int-range",
			},
			{
				Key:      SecretUsername,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.rabbitmq.form.username",
				Required: true,
			},
			{
				Key:      SecretPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.rabbitmq.form.password",
				Required: true,
			},
		},
	}
}

// Open dials the management API.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	endpoint, err := normaliseEndpoint(profile.Endpoints)
	if err != nil {
		return nil, err
	}
	vhost := profile.Option(OptionVHost)
	if vhost == "" {
		vhost = defaultVHost
	}
	conn := &Conn{
		mgmt: newMgmt(
			endpoint,
			profile.Secret(SecretUsername),
			profile.Secret(SecretPassword),
			newTransport(dialTimeout(profile)),
		),
		vhost:    vhost,
		endpoint: endpoint,
	}
	conn.probe(ctx)
	return conn, nil
}

// normaliseEndpoint accepts a bare host or host:port as well as a full URL,
// because the connection form asks for an address and users type all three.
func normaliseEndpoint(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		return "", fmt.Errorf("management API address cannot be empty")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid management API address %q: %w", raw, err)
	}
	if parsed.Port() == "" {
		parsed.Host = parsed.Host + ":" + defaultMgmtPort
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

// newTransport is the HTTP transport one connection's management calls share.
//
// It exists per connection rather than per process because it carries that
// profile's timeout, and later its TLS settings: two profiles against one
// broker need not agree on either.
func newTransport(dial time.Duration) http.RoundTripper {
	return &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: dial, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout: dial,
		MaxIdleConns:        8,
		IdleConnTimeout:     60 * time.Second,
	}
}

// dialTimeout is the profile's own timeout, which is what the connection form
// collects. It bounds reaching the host at all - something a request deadline
// cannot do on its own, because a host that never answers SYN consumes the
// whole budget before the first byte.
func dialTimeout(profile model.ConnectionProfile) time.Duration {
	if profile.TimeoutSec > 0 {
		return time.Duration(profile.TimeoutSec) * time.Second
	}
	return defaultDialTimeout
}

const defaultDialTimeout = 5 * time.Second
