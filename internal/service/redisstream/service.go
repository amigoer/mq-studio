// Package redisstream orchestrates the operations only Redis Streams has.
//
// It exists beside the canonical services rather than inside them because the
// questions are Redis's own: what a trim removed, what is sitting in a group's
// pending list, what the server has been slow at. Bending those into a shape
// every family shares would cost the detail that makes them worth showing.
//
// The canonical services still serve Redis everything they can express -
// a stream is a destination, a consumer group is a subscription - so nothing
// here duplicates them.
package redisstream

import (
	"context"
	"errors"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
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
// needs, checking the declared capability first.
//
// The capability check comes before the type assertion for the same reason it
// does in every other service: a driver should not have to refuse an operation
// the interface was never meant to offer, and the reason a page gets back
// should name the capability rather than the Go type.
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

// Trim discards entries from the head of a stream, by length or by position.
func (s *Service) Trim(ctx context.Context, connID int, request model.TrimRequest) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Trim(ctx, request)
}

// DeleteEntries removes named entries from a stream.
func (s *Service) DeleteEntries(ctx context.Context, connID int, ref model.DestinationRef, ids []string) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeleteEntries(ctx, ref, ids)
}

// notConnected reports whether the failure is simply that nothing is dialled.
//
// List pages answer that with an empty result rather than an error: the board
// renders its own not-connected state, and a red error on top of it says
// something went wrong when nothing did.
func notConnected(err error) bool {
	return errors.Is(err, driver.ErrNotConnected)
}

var _ = notConnected

// CreateGroup declares a consumer group on a stream.
//
// It goes through the canonical SubscriptionAdmin port - the port fits - but
// not through the canonical service, because ConsumerService addresses a group
// by name and a broker address. A Redis group's name is unique only within its
// stream, so a reference that cannot carry the stream cannot name it at all.
func (s *Service) CreateGroup(ctx context.Context, connID int, spec model.SubscriptionSpec) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateSubscription(ctx, spec)
}

// DeleteGroup destroys a consumer group and every pending entry it holds. The
// entries stay in the stream; they are simply no longer owed to anyone.
func (s *Service) DeleteGroup(ctx context.Context, connID int, ref model.SubscriptionRef) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveSubscription(ctx, ref)
}

// SetGroupPosition moves a consumer group to a named place in the log.
//
// It leaves the pending list alone: entries already handed out stay owed to
// the consumers holding them, wherever the group now reads from. That is the
// server's behaviour rather than a choice made here, and the page says so.
func (s *Service) SetGroupPosition(ctx context.Context, connID int, request model.PositionRequest) error {
	api, err := port[driver.StreamPositionAdmin](s, connID, model.CapSubscriptionPosition)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetSubscriptionPosition(ctx, request)
}

// AddEntry writes entries to a stream and reports the ids the server assigned.
func (s *Service) AddEntry(ctx context.Context, connID int, request model.StreamAddRequest) (*model.StreamAddResult, error) {
	api, err := port[driver.EntryPublisher](s, connID, model.CapEntryPublish)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AddEntry(ctx, request)
}

// PendingSummary is a group's pending list at a glance: how much is owed, over
// what range, and who is holding it.
func (s *Service) PendingSummary(ctx context.Context, connID int, ref model.SubscriptionRef) (*model.PendingSummary, error) {
	api, err := port[driver.PendingEntryReader](s, connID, model.CapPendingEntries)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PendingSummary(ctx, ref)
}

// PendingEntries walks the list itself.
func (s *Service) PendingEntries(ctx context.Context, connID int, query model.PendingQuery) ([]*model.PendingEntry, error) {
	api, err := port[driver.PendingEntryReader](s, connID, model.CapPendingEntries)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PendingEntries(ctx, query)
}

// GroupConsumers lists a group's members and how long each has been quiet.
func (s *Service) GroupConsumers(ctx context.Context, connID int, ref model.SubscriptionRef) ([]*model.GroupConsumer, error) {
	api, err := port[driver.PendingEntryReader](s, connID, model.CapPendingEntries)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.GroupConsumers(ctx, ref)
}

// AckEntries settles entries so they stop being owed.
func (s *Service) AckEntries(ctx context.Context, connID int, ref model.SubscriptionRef, ids []string) (*model.AckResult, error) {
	api, err := port[driver.PendingEntryActions](s, connID, model.CapPendingAdmin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AckEntries(ctx, ref, ids)
}

// ClaimEntries moves named entries to another consumer.
func (s *Service) ClaimEntries(ctx context.Context, connID int, request model.ClaimRequest) (*model.ClaimResult, error) {
	api, err := port[driver.PendingEntryActions](s, connID, model.CapPendingAdmin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ClaimEntries(ctx, request)
}

// AutoClaim moves whatever has been idle too long, without naming ids.
func (s *Service) AutoClaim(ctx context.Context, connID int, request model.AutoClaimRequest) (*model.ClaimResult, error) {
	api, err := port[driver.PendingEntryActions](s, connID, model.CapPendingAdmin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AutoClaim(ctx, request)
}

// SlowLog reads what has actually been slow on a server.
func (s *Service) SlowLog(ctx context.Context, connID int, address string, limit int) ([]*model.SlowLogEntry, error) {
	api, err := port[driver.SlowLogReader](s, connID, model.CapSlowLog)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SlowLog(ctx, address, limit)
}

// ClientConnections lists what is connected to the server.
func (s *Service) ClientConnections(ctx context.Context, connID int) ([]*model.ClientConnection, error) {
	api, err := port[driver.ClientInspector](s, connID, model.CapClientInspect)
	if err != nil {
		if notConnected(err) {
			return []*model.ClientConnection{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListClientConnections(ctx, "")
}

// CloseClient disconnects one client by its id.
func (s *Service) CloseClient(ctx context.Context, connID int, id string) error {
	api, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CloseClientConnection(ctx, id, "")
}

// CloseUserClients disconnects every connection one identity holds, which is
// how an application with several instances is actually evicted.
func (s *Service) CloseUserClients(ctx context.Context, connID int, username string) error {
	api, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CloseUserConnections(ctx, username, "")
}

// AclUsers lists the principals the server authenticates.
func (s *Service) AclUsers(ctx context.Context, connID int) ([]*model.AclUser, error) {
	api, err := port[driver.AclUserAdmin](s, connID, model.CapAclUsers)
	if err != nil {
		if notConnected(err) {
			return []*model.AclUser{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListAclUsers(ctx)
}

// AclCategories are the command groups rules are written in terms of.
func (s *Service) AclCategories(ctx context.Context, connID int) ([]string, error) {
	api, err := port[driver.AclUserAdmin](s, connID, model.CapAclUsers)
	if err != nil {
		if notConnected(err) {
			return []string{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AclCategories(ctx)
}

// SaveAclUser creates or replaces a user.
func (s *Service) SaveAclUser(ctx context.Context, connID int, spec model.AclUserSpec) error {
	api, err := port[driver.AclUserAdmin](s, connID, model.CapAclUsers)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SaveAclUser(ctx, spec)
}

// RemoveAclUser deletes a user and disconnects whatever was using it.
func (s *Service) RemoveAclUser(ctx context.Context, connID int, name string) error {
	api, err := port[driver.AclUserAdmin](s, connID, model.CapAclUsers)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveAclUser(ctx, name)
}
