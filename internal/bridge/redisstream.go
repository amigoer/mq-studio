package bridge

import (
	"context"

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
