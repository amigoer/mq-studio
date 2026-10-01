package mcpserver

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// namespacedConn either keeps destinations apart by namespace or answers every
// call from its own scope, which is the difference the refusals exist to catch.
type namespacedConn struct {
	fakeConn
	scoped  bool
	depth   int64
	removed []model.DestinationRef
	purged  []model.DestinationRef
}

func (c *namespacedConn) answerFrom(namespace string) string {
	if c.scoped {
		return namespace
	}
	return ""
}

func (c *namespacedConn) ListDestinations(
	_ context.Context, filter model.DestinationFilter,
) ([]*model.Destination, error) {
	return []*model.Destination{{Ref: model.DestinationRef{
		Namespace: c.answerFrom(filter.Namespace), Name: "orders"}}}, nil
}

func (c *namespacedConn) DestinationDetail(
	_ context.Context, ref model.DestinationRef,
) (*model.Destination, error) {
	return &model.Destination{Ref: model.DestinationRef{
		Namespace: c.answerFrom(ref.Namespace), Name: ref.Name}, Depth: c.depth}, nil
}

func (c *namespacedConn) CreateDestination(context.Context, model.DestinationSpec) error {
	return nil
}

func (c *namespacedConn) UpdateDestination(context.Context, model.DestinationSpec) error {
	return nil
}

func (c *namespacedConn) RemoveDestination(_ context.Context, ref model.DestinationRef) error {
	c.removed = append(c.removed, ref)
	return nil
}

func (c *namespacedConn) PurgeQueue(_ context.Context, ref model.DestinationRef) error {
	c.purged = append(c.purged, ref)
	return nil
}

func (c *namespacedConn) MoveMessages(context.Context, model.MoveRequest) (int, error) { return 0, nil }

func (c *namespacedConn) DropMessages(context.Context, model.DestinationRef, int) (int, error) {
	return 0, nil
}

func (c *namespacedConn) RebalanceQueues(context.Context) error { return nil }

type requestTimeout struct{}

func (requestTimeout) GetRequestTimeout() time.Duration { return time.Second }
func (requestTimeout) GetFetchLimit() int               { return 32 }
