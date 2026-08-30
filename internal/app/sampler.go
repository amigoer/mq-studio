package app

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/collector"
)

// sampleActiveConnection adapts the cluster service to the collector.
//
// The collector has no connection to name: it samples whatever is open, on its
// own timer, with nobody looking. The active id is resolved here rather than
// left as the id-keyed connection source's "the active one", because history
// is filed under the connection it was sampled through - a sample filed under
// zero is one the page that names its connection would never find.
func sampleActiveConnection(service *cluster.Service, registry *driver.Registry) collector.Sampler {
	return samplerFunc(func(ctx context.Context) error {
		connID := registry.ActiveID()
		if connID == 0 {
			// Closed between the collector's probe and this call. Nothing to
			// sample is not a failure.
			return nil
		}
		return service.CollectTPSSample(ctx, connID)
	})
}

type samplerFunc func(context.Context) error

func (f samplerFunc) CollectTPSSample(ctx context.Context) error { return f(ctx) }
