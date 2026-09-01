package bridge

import (
	"context"

	redisstreamdriver "github.com/amigoer/mq-studio/internal/driver/redisstream"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/redisstream"
)

// RedisStreamService exposes what only Redis Streams has.
//
// It is one service rather than several because it is one family's surface:
// splitting trimming, the pending list and the server's own figures into three
// would put three names in the bindings for what a reader thinks of as "the
// Redis pages".
type RedisStreamService struct {
	service *redisstream.Service
}

// TrimInput is a trim as the dialog collects it.
//
// The strategy is a string rather than two methods because it is one command
// with two ways of naming a bound, and a page that had to pick an endpoint
// before the user picked a strategy would be the wrong shape.
type TrimInput struct {
	Stream   string `json:"stream"`
	Strategy string `json:"strategy"`
	// MaxLen is how many of the newest entries to keep, for the maxlen
	// strategy. Zero empties the stream and keeps the key, its groups and
	// their positions.
	MaxLen int64 `json:"maxLen"`
	// MinID is the lowest entry id to keep, for the minid strategy.
	MinID string `json:"minId"`
	// Approx lets the server stop at a node boundary. The stream then keeps at
	// least what was asked and possibly a little more, never less.
	Approx bool `json:"approx"`
}

func (input TrimInput) request() model.TrimRequest {
	return model.TrimRequest{
		Ref:      model.DestinationRef{Name: input.Stream},
		Strategy: model.TrimStrategy(input.Strategy),
		MaxLen:   input.MaxLen,
		MinID:    input.MinID,
		Approx:   input.Approx,
	}
}

// Trim discards entries from the head of a stream and reports how many went.
func (s *RedisStreamService) Trim(connID int, input TrimInput) (*model.TrimResult, error) {
	return s.service.Trim(context.Background(), connID, input.request())
}

// DeleteEntries removes named entries and reports how many were there to
// remove, which is not the same as how many were asked for.
func (s *RedisStreamService) DeleteEntries(connID int, stream string, ids []string) (*model.TrimResult, error) {
	return s.service.DeleteEntries(context.Background(), connID,
		model.DestinationRef{Name: stream}, ids)
}

// GroupInput is a consumer group as the form collects it.
//
// The stream is a field rather than part of the name because a group's name is
// unique only within its stream: two streams may each hold a "settle-group"
// and they are unrelated objects.
type GroupInput struct {
	Stream string `json:"stream"`
	Group  string `json:"group"`
	// StartID is where the group begins reading: "0" for everything the stream
	// still holds, "$" for only what arrives next. Empty means "$", which is
	// the answer that cannot flood a consumer with history.
	StartID string `json:"startId"`
}

// CreateGroup declares a consumer group on a stream.
func (s *RedisStreamService) CreateGroup(connID int, input GroupInput) error {
	return s.service.CreateGroup(context.Background(), connID, model.SubscriptionSpec{
		Ref:        groupRefOf(input.Stream, input.Group),
		Attributes: map[string]string{redisstreamdriver.AttrStartID: input.StartID},
	})
}

// DeleteGroup destroys a consumer group and the pending entries it holds.
func (s *RedisStreamService) DeleteGroup(connID int, stream string, group string) error {
	return s.service.DeleteGroup(context.Background(), connID, groupRefOf(stream, group))
}

// SetGroupPosition moves a consumer group to an entry id, to "0" for the
// beginning of what the stream still holds, or to "$" for whatever arrives
// next.
func (s *RedisStreamService) SetGroupPosition(connID int, stream string, group string, position string) error {
	return s.service.SetGroupPosition(context.Background(), connID, model.PositionRequest{
		Ref:      groupRefOf(stream, group),
		Position: position,
	})
}

// EntryInput is an entry as the send console collects it.
//
// The fields are a list rather than an object because XADD takes an ordered
// one and the order is the producer's. A JSON object would arrive with
// whatever order the renderer's serialiser chose.
type EntryInput struct {
	Stream string              `json:"stream"`
	Fields []model.StreamField `json:"fields"`
	// ID is an explicit entry id. Empty lets the server assign one, which is
	// what almost every producer does.
	ID string `json:"id"`
	// Count writes the same entry more than once, for filling a stream to try
	// a consumer against.
	Count int `json:"count"`
}

// AddEntry writes to a stream and returns the ids the server assigned.
//
// The ids rather than a count: an id is the only handle on an entry, so a
// console that reported "sent 5" would leave the user unable to find any of
// them.
func (s *RedisStreamService) AddEntry(connID int, input EntryInput) (*model.StreamAddResult, error) {
	return s.service.AddEntry(context.Background(), connID, model.StreamAddRequest{
		Ref:    model.DestinationRef{Name: input.Stream},
		Fields: input.Fields,
		ID:     input.ID,
		Count:  input.Count,
	})
}

// PendingSummary returns a group's pending list at a glance.
func (s *RedisStreamService) PendingSummary(connID int, stream string, group string) (*model.PendingSummary, error) {
	return s.service.PendingSummary(context.Background(), connID, groupRefOf(stream, group))
}

// PendingQueryInput narrows a pending listing as the board collects it.
type PendingQueryInput struct {
	Stream string `json:"stream"`
	Group  string `json:"group"`
	// Consumer narrows to one consumer's share. Empty is all of them.
	Consumer string `json:"consumer"`
	// MinIdleMs narrows to entries nothing has touched for at least this long,
	// which is how the ones worth acting on are found.
	MinIdleMs int64 `json:"minIdleMs"`
	Count     int   `json:"count"`
}

// PendingEntries walks a group's pending list.
func (s *RedisStreamService) PendingEntries(connID int, input PendingQueryInput) ([]*model.PendingEntry, error) {
	return s.service.PendingEntries(context.Background(), connID, model.PendingQuery{
		Ref:       groupRefOf(input.Stream, input.Group),
		Consumer:  input.Consumer,
		MinIdleMs: input.MinIdleMs,
		Count:     input.Count,
	})
}

// GroupConsumers lists a group's members and how long each has been quiet.
func (s *RedisStreamService) GroupConsumers(connID int, stream string, group string) ([]*model.GroupConsumer, error) {
	return s.service.GroupConsumers(context.Background(), connID, groupRefOf(stream, group))
}

// AckEntries settles entries so they stop being owed, and reports how many
// were actually owed - which is not how many were named.
func (s *RedisStreamService) AckEntries(connID int, stream string, group string, ids []string) (*model.AckResult, error) {
	return s.service.AckEntries(context.Background(), connID, groupRefOf(stream, group), ids)
}

// ClaimInput moves named entries to another consumer.
type ClaimInput struct {
	Stream string `json:"stream"`
	Group  string `json:"group"`
	// Consumer is the new owner. It need not exist yet: claiming creates it,
	// which is how a replacement worker takes over from a dead one.
	Consumer string   `json:"consumer"`
	IDs      []string `json:"ids"`
	// MinIdleMs refuses to move anything touched more recently than this. Zero
	// moves regardless, which is a choice rather than a default.
	MinIdleMs int64 `json:"minIdleMs"`
}

// ClaimEntries moves named entries to another consumer.
func (s *RedisStreamService) ClaimEntries(connID int, input ClaimInput) (*model.ClaimResult, error) {
	return s.service.ClaimEntries(context.Background(), connID, model.ClaimRequest{
		Ref:       groupRefOf(input.Stream, input.Group),
		Consumer:  input.Consumer,
		IDs:       input.IDs,
		MinIdleMs: input.MinIdleMs,
	})
}

// AutoClaimInput moves whatever has been idle too long, without naming ids.
type AutoClaimInput struct {
	Stream    string `json:"stream"`
	Group     string `json:"group"`
	Consumer  string `json:"consumer"`
	MinIdleMs int64  `json:"minIdleMs"`
	// Start is where to resume from when walking a long list. Empty starts at
	// the beginning.
	Start string `json:"start"`
	Count int    `json:"count"`
}

// AutoClaim moves whatever has been idle too long and reports what it found
// gone as well as what it moved.
func (s *RedisStreamService) AutoClaim(connID int, input AutoClaimInput) (*model.ClaimResult, error) {
	return s.service.AutoClaim(context.Background(), connID, model.AutoClaimRequest{
		Ref:       groupRefOf(input.Stream, input.Group),
		Consumer:  input.Consumer,
		MinIdleMs: input.MinIdleMs,
		Start:     input.Start,
		Count:     input.Count,
	})
}

// groupRefOf addresses a consumer group. Both halves are needed: a group's
// name is unique only within the stream it reads.
func groupRefOf(stream, group string) model.SubscriptionRef {
	return model.SubscriptionRef{Namespace: stream, Name: group}
}

// SlowLog reads the record a server keeps of its slowest commands.
//
// It is not on ClusterService because no other family has one: what a node is
// running with is a shared question, what has been slow on it is Redis's.
func (s *RedisStreamService) SlowLog(connID int, address string, limit int) ([]*model.SlowLogEntry, error) {
	return s.service.SlowLog(context.Background(), connID, address, limit)
}

// ClientConnections lists what is connected to the server.
func (s *RedisStreamService) ClientConnections(connID int) ([]*model.ClientConnection, error) {
	return s.service.ClientConnections(context.Background(), connID)
}

// CloseClient disconnects one client.
//
// It takes the connection's id rather than its address: Redis kills by either,
// and an address is reused the moment its port is - so a client that
// reconnected between the page being drawn and the button being pressed would
// be killed in place of the one the operator meant.
func (s *RedisStreamService) CloseClient(connID int, id string) error {
	return s.service.CloseClient(context.Background(), connID, id)
}

// CloseUserClients disconnects every connection one identity holds.
func (s *RedisStreamService) CloseUserClients(connID int, username string) error {
	return s.service.CloseUserClients(context.Background(), connID, username)
}
