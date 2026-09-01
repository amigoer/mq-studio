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
		Ref:        model.SubscriptionRef{Namespace: input.Stream, Name: input.Group},
		Attributes: map[string]string{redisstreamdriver.AttrStartID: input.StartID},
	})
}

// DeleteGroup destroys a consumer group and the pending entries it holds.
func (s *RedisStreamService) DeleteGroup(connID int, stream string, group string) error {
	return s.service.DeleteGroup(context.Background(), connID,
		model.SubscriptionRef{Namespace: stream, Name: group})
}
