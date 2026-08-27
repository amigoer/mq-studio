// Package message orchestrates message browse and publish for whichever
// broker the active connection speaks.
package message

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what message operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
	GetFetchLimit() int
}

// ConnSource yields the connection a request runs against.
//
// Taking an id is what lets a caller name the connection instead of relying
// on an implicit default, which is the whole reason the bridge signatures
// grew one.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and a driver.
type Service struct {
	conns    ConnSource
	settings Settings
	nextID   int64
}

// New creates a message service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings, nextID: 1}
}

func (s *Service) nextListID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

func (s *Service) assignIDs(items []*model.MessageItem) []*model.MessageItem {
	for _, item := range items {
		if item != nil {
			item.ID = s.nextListID()
		}
	}
	return items
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// FetchLimit is the page size a caller should ask for when it has no
// preference. It stays in the service because it is an application setting,
// not something a broker knows about.
func (s *Service) FetchLimit() int {
	return s.settings.GetFetchLimit()
}

// Query searches a destination.
func (s *Service) Query(ctx context.Context, connID int, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.MessageReader)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapMessageQuery)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	items, err := api.QueryMessages(ctx, params)
	if err != nil {
		return nil, err
	}
	return s.assignIDs(items), nil
}

// ByID returns one message by its broker-assigned id.
func (s *Service) ByID(ctx context.Context, connID int, topic, messageID string) (*model.MessageItem, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.MessageReader)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapMessageByID)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	item, err := api.MessageByID(ctx, topic, messageID)
	if err != nil {
		return nil, err
	}
	if item != nil {
		item.ID = s.nextListID()
	}
	return item, nil
}

// Track reports which subscriptions have consumed a message.
func (s *Service) Track(ctx context.Context, connID int, topic, messageID string) ([]*model.MessageTrackItem, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.MessageTracker)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapMessageTrack)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.TrackMessage(ctx, topic, messageID)
}

// DLQ browses a subscription's dead-letter backlog.
func (s *Service) DLQ(ctx context.Context, connID int, group string, maxResults int) ([]*model.MessageItem, error) {
	api, ctx, cancel, err := s.deadLetter(ctx, connID)
	if err != nil {
		return nil, err
	}
	defer cancel()

	items, err := api.DLQMessages(ctx, group, maxResults)
	if err != nil {
		return nil, err
	}
	return s.assignIDs(items), nil
}

// Retry browses a subscription's retry backlog.
func (s *Service) Retry(ctx context.Context, connID int, group string, maxResults int) ([]*model.MessageItem, error) {
	api, ctx, cancel, err := s.deadLetter(ctx, connID)
	if err != nil {
		return nil, err
	}
	defer cancel()

	items, err := api.RetryMessages(ctx, group, maxResults)
	if err != nil {
		return nil, err
	}
	return s.assignIDs(items), nil
}

// Resend pushes a message back to a subscription.
func (s *Service) Resend(ctx context.Context, connID int, consumerGroup, clientID, topic, messageID string) (string, error) {
	api, ctx, cancel, err := s.deadLetter(ctx, connID)
	if err != nil {
		return "", err
	}
	defer cancel()
	return api.ResendMessage(ctx, consumerGroup, clientID, topic, messageID)
}

func (s *Service) deadLetter(ctx context.Context, connID int) (driver.DeadLetterReader, context.Context, context.CancelFunc, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, nil, func() {}, err
	}
	api, ok := conn.(driver.DeadLetterReader)
	if !ok {
		return nil, nil, func() {}, driver.Unsupported(conn, model.CapDLQ)
	}
	ctx, cancel := s.withTimeout(ctx)
	return api, ctx, cancel, nil
}

// Send publishes a message.
func (s *Service) Send(ctx context.Context, connID int, topic, tags, keys, body string, delayLevel int) (string, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return "", err
	}
	if !conn.Capabilities().Has(model.CapPublish) {
		return "", driver.Unsupported(conn, model.CapPublish)
	}
	api, ok := conn.(driver.MessagePublisher)
	if !ok {
		return "", driver.Unsupported(conn, model.CapPublish)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SendMessage(ctx, topic, tags, keys, body, delayLevel)
}
