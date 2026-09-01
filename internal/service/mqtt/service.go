// Package mqtt orchestrates the operations only MQTT has.
//
// It exists beside the canonical services because the canonical ones cannot
// express the questions. A live subscription is the clearest case: it is not a
// consumer group with an offset to reset, it is a session-scoped stream that
// exists while someone is watching and is gone afterwards, so there is no
// canonical service with anywhere to put it.
//
// The canonical services still serve MQTT everything they can express -
// retained topics are destinations, connected clients are client connections,
// the broker is a node - so nothing here duplicates a read that already has a
// home.
package mqtt

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	mqttdriver "github.com/amigoer/mq-studio/internal/driver/mqtt"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what these operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and the driver.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates the service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// port resolves the connection and asserts it implements what the caller
// needs, checking the declared capability first, the same way the Kafka and
// RabbitMQ services do.
func port[T any](s *Service, connID int, capability model.Capability) (T, error) {
	var zero T
	conn, err := s.conns(connID)
	if err != nil {
		return zero, err
	}
	if !conn.Capabilities().Has(capability) {
		return zero, driver.Unsupported(conn, capability)
	}
	api, ok := conn.(T)
	if !ok {
		return zero, driver.Unsupported(conn, capability)
	}
	return api, nil
}

// Publish sends a message with everything MQTT can carry.
//
// Separate from the canonical publish because model.PublishRequest is
// AMQP-shaped: exchange, routing key, mandatory and priority have no MQTT
// counterpart, and QoS, retain and the 5.0 properties have no AMQP one.
func (s *Service) Publish(
	ctx context.Context, connID int, request mqttdriver.PublishRequest,
) (*mqttdriver.PublishResult, error) {
	publisher, err := port[*mqttdriver.Conn](s, connID, model.CapPublish)
	if err != nil {
		return nil, err
	}

	// A repeat count multiplies the round trips, so the budget is per message
	// rather than per press: a hundred QoS 2 publishes cannot fit in one
	// request timeout, and cutting the batch off half way would leave the user
	// unable to tell how many went.
	timeout := s.settings.GetRequestTimeout()
	if request.Count > 1 {
		timeout *= time.Duration(request.Count)
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	return publisher.Publish(callCtx, request)
}

// StartSubscription opens a live stream and starts buffering it.
func (s *Service) StartSubscription(
	ctx context.Context, connID int, spec model.LiveSubscriptionSpec,
) (*model.LiveSubscription, error) {
	subscriber, err := port[driver.LiveSubscriber](s, connID, model.CapLiveStream)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return subscriber.StartLiveSubscription(callCtx, spec)
}

// PollSubscription drains what has arrived since the caller's last sequence.
func (s *Service) PollSubscription(
	ctx context.Context, connID int, id string, after int64, limit int,
) (*model.LiveBatch, error) {
	subscriber, err := port[driver.LiveSubscriber](s, connID, model.CapLiveStream)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return subscriber.PollLiveSubscription(callCtx, id, after, limit)
}

// StopSubscription ends a stream and unsubscribes on the broker.
func (s *Service) StopSubscription(ctx context.Context, connID int, id string) error {
	subscriber, err := port[driver.LiveSubscriber](s, connID, model.CapLiveStream)
	if err != nil {
		return err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return subscriber.StopLiveSubscription(callCtx, id)
}

// Subscriptions is what this connection is currently streaming, so a panel
// that remounts finds its own stream again instead of starting a second one.
func (s *Service) Subscriptions(ctx context.Context, connID int) ([]*model.LiveSubscription, error) {
	subscriber, err := port[driver.LiveSubscriber](s, connID, model.CapLiveStream)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return subscriber.LiveSubscriptions(callCtx)
}

// Clients is who the broker is holding a session for.
//
// The canonical client inspection has no bridge service of its own - RabbitMQ
// exposes it on its own, and so does this - so the read lands here rather than
// duplicating a shared one that does not exist.
func (s *Service) Clients(ctx context.Context, connID int) ([]*model.ClientConnection, error) {
	inspector, err := port[driver.ClientInspector](s, connID, model.CapClientInspect)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return inspector.ListClientConnections(callCtx, "")
}

// KickClient ends one client's session.
//
// MQTT carries no reason on a disconnect - the broker sends a reason code and
// no text - so there is no reason argument to take. One that went nowhere
// would have the operator believe the client was told why.
func (s *Service) KickClient(ctx context.Context, connID int, clientID string) error {
	closer, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return closer.CloseClientConnection(callCtx, clientID, "")
}

// KickUser ends every session a username holds.
func (s *Service) KickUser(ctx context.Context, connID int, username string) error {
	closer, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return closer.CloseUserConnections(callCtx, username, "")
}

// ClientSubscriptions is the topic filters one client holds, read from the
// broker's own management API.
func (s *Service) ClientSubscriptions(
	ctx context.Context, connID int, clientID string,
) ([]*mqttdriver.ClientSubscription, error) {
	inspector, err := port[*mqttdriver.Conn](s, connID, model.CapClientInspect)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return inspector.ClientSubscriptions(callCtx, clientID)
}

// BrokerSubscriptions is every filter the broker is holding, across clients.
func (s *Service) BrokerSubscriptions(
	ctx context.Context, connID int,
) ([]*mqttdriver.ClientSubscription, error) {
	inspector, err := port[*mqttdriver.Conn](s, connID, model.CapClientInspect)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := s.withTimeout(ctx)
	defer cancel()
	return inspector.Subscriptions(callCtx)
}
