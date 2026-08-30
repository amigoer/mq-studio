package rabbitmq

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// clientName is what this app calls itself on an AMQP connection.
//
// The broker shows it in its own connection list, and an operator looking at
// an unexpected consumer there deserves to see who it is rather than an IP and
// a port.
const clientName = "mq-studio"

// connectionName adds the profile to that, because the app name alone stops
// being useful the moment someone has two profiles against one broker.
func connectionName(profile string) string {
	if profile = strings.TrimSpace(profile); profile != "" {
		return clientName + ": " + profile
	}
	return clientName
}

// amqpIdleTimeout is how long a data-plane connection survives unused.
//
// It exists because most of this app is admin work over HTTP. A session that
// only lists queues should not sit in the broker's connection list all day, so
// the connection is opened when a message operation needs it and dropped again
// once nothing does.
const amqpIdleTimeout = 90 * time.Second

// amqpHeartbeat is deliberately short. A desktop app on a laptop gets
// suspended, and a half-open connection that only fails when a publish is
// attempted is worse than one that has already been noticed.
const amqpHeartbeat = 10 * time.Second

// dataPlane is the AMQP side of one connection.
//
// It exists because the management API is not a data plane: its publish
// endpoint has no publisher confirms and its own documentation says not to use
// it for real traffic, and its get endpoint moves messages rather than reading
// them. Everything that touches a message goes through here instead.
type dataPlane struct {
	uri         amqp.URI
	name        string
	tlsConfig   *tls.Config
	dialTimeout time.Duration

	mu     sync.Mutex
	conn   *amqp.Connection
	active int
	idle   *time.Timer
}

func newDataPlane(uri amqp.URI, name string, tlsConfig *tls.Config, dialTimeout time.Duration) *dataPlane {
	return &dataPlane{uri: uri, name: name, tlsConfig: tlsConfig, dialTimeout: dialTimeout}
}

// address is the host and port, for error messages. The URI itself carries the
// password and must never reach one.
func (p *dataPlane) address() string {
	return net.JoinHostPort(p.uri.Host, fmt.Sprint(p.uri.Port))
}

// withChannel runs one operation on a channel of the shared connection.
//
// A channel per operation rather than a shared one: channels are cheap, and
// AMQP closes the whole channel on a protocol error, so sharing would let one
// failed publish take down an unrelated browse.
func (p *dataPlane) withChannel(ctx context.Context, fn func(*amqp.Channel) error) error {
	channel, release, err := p.channel(ctx)
	if err == nil {
		defer release()
		return fn(channel)
	}
	if !errors.Is(err, errStaleConnection) {
		return err
	}
	// The pooled connection had died since it was last used. That is normal
	// after an idle period or a broker restart, so it is worth one retry
	// rather than an error the user has to act on.
	channel, release, err = p.channel(ctx)
	if err != nil {
		return err
	}
	defer release()
	return fn(channel)
}

// errStaleConnection means the cached connection was dead. It is internal: the
// caller retries rather than reporting it.
var errStaleConnection = errors.New("amqp connection is stale")

func (p *dataPlane) channel(ctx context.Context) (*amqp.Channel, func(), error) {
	conn, err := p.acquire(ctx)
	if err != nil {
		return nil, nil, err
	}
	channel, err := conn.Channel()
	if err != nil {
		p.discard(conn)
		p.release()
		return nil, nil, fmt.Errorf("%w: %v", errStaleConnection, err)
	}
	return channel, func() {
		_ = channel.Close()
		p.release()
	}, nil
}

func (p *dataPlane) acquire(ctx context.Context) (*amqp.Connection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.idle != nil {
		p.idle.Stop()
		p.idle = nil
	}
	if p.conn != nil && !p.conn.IsClosed() {
		p.active++
		return p.conn, nil
	}

	conn, err := p.dial(ctx)
	if err != nil {
		return nil, err
	}
	p.conn = conn
	p.active++
	return conn, nil
}

// release arms the idle timer once nothing is using the connection.
func (p *dataPlane) release() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.active > 0 {
		p.active--
	}
	if p.active > 0 || p.conn == nil {
		return
	}
	p.idle = time.AfterFunc(amqpIdleTimeout, p.closeIfIdle)
}

func (p *dataPlane) closeIfIdle() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.active > 0 || p.conn == nil {
		return
	}
	_ = p.conn.Close()
	p.conn = nil
}

// discard drops a connection the caller found dead, unless it has already been
// replaced by a concurrent dial.
func (p *dataPlane) discard(dead *amqp.Connection) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == dead {
		_ = p.conn.Close()
		p.conn = nil
	}
}

func (p *dataPlane) dial(ctx context.Context) (*amqp.Connection, error) {
	config := amqp.Config{
		Vhost:      p.uri.Vhost,
		Heartbeat:  amqpHeartbeat,
		Locale:     "en_US",
		Properties: amqp.Table{"connection_name": p.name},
		Dial: func(network, addr string) (net.Conn, error) {
			dialer := &net.Dialer{Timeout: p.dialTimeout}
			return dialer.DialContext(ctx, network, addr)
		},
	}
	if p.tlsConfig != nil {
		config.TLSClientConfig = p.tlsConfig
	}

	conn, err := amqp.DialConfig(p.uri.String(), config)
	if err != nil {
		// The URI carries the password, so the address is all that goes into
		// the message.
		return nil, fmt.Errorf("dial amqp %s: %w", p.address(), err)
	}
	return conn, nil
}

// ping opens and closes a channel, which is the cheapest thing that proves the
// broker accepted the credentials and the vhost.
func (p *dataPlane) ping(ctx context.Context) error {
	return p.withChannel(ctx, func(*amqp.Channel) error { return nil })
}

func (p *dataPlane) close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.idle != nil {
		p.idle.Stop()
		p.idle = nil
	}
	if p.conn != nil {
		_ = p.conn.Close()
		p.conn = nil
	}
	p.active = 0
}

// amqpDegradeReason names why the data plane is unavailable.
//
// ACCESS_REFUSED is worth its own reason: the management user and the AMQP
// user are the same credential here, so a connection whose admin side works
// and whose data side does not is almost always a vhost permission rather than
// a wrong password.
func amqpDegradeReason(err error) string {
	var amqpErr *amqp.Error
	if errors.As(err, &amqpErr) && amqpErr.Code == amqp.AccessRefused {
		return amqpAccessRefused
	}
	if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
		return amqpTimedOut
	}
	return amqpUnreachable
}

// amqpAddress builds the data-plane address.
//
// The form asks for it separately from the management address because they are
// two listeners on two ports and need not even be on one host - a proxy
// commonly terminates one and not the other. Left empty it is derived from the
// management host, which is what most deployments want.
func amqpAddress(raw, management, vhost, username, password string, useTLS bool) (amqp.URI, error) {
	scheme := "amqp"
	if useTLS {
		scheme = "amqps"
	}

	endpoint := strings.TrimSpace(raw)
	if endpoint == "" {
		host, err := hostOf(management)
		if err != nil {
			return amqp.URI{}, err
		}
		endpoint = scheme + "://" + host
	} else if !strings.Contains(endpoint, "://") {
		endpoint = scheme + "://" + endpoint
	}

	uri, err := amqp.ParseURI(endpoint)
	if err != nil {
		return amqp.URI{}, fmt.Errorf("invalid AMQP address %q: %w", raw, err)
	}
	// The scheme the switch asks for wins over one typed into the address, so
	// turning TLS on cannot leave a plaintext connection behind.
	if uri.Scheme != scheme {
		uri.Scheme = scheme
		if uri.Port == defaultPortFor(oppositeScheme(scheme)) {
			uri.Port = defaultPortFor(scheme)
		}
	}

	uri.Username = username
	uri.Password = password
	if vhost != "" {
		uri.Vhost = vhost
	}
	return uri, nil
}

// hostOf takes the host out of the management address, dropping its port: the
// two planes listen on different ones.
func hostOf(management string) (string, error) {
	parsed, err := url.Parse(management)
	if err != nil {
		return "", fmt.Errorf("invalid management address %q: %w", management, err)
	}
	if parsed.Hostname() == "" {
		return "", fmt.Errorf("management address %q has no host", management)
	}
	return parsed.Hostname(), nil
}

func defaultPortFor(scheme string) int {
	if scheme == "amqps" {
		return 5671
	}
	return 5672
}

func oppositeScheme(scheme string) string {
	if scheme == "amqps" {
		return "amqp"
	}
	return "amqps"
}
