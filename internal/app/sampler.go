package app

import (
	"context"

	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/collector"
)

// sampleActiveConnection adapts the cluster service to the collector.
//
// The collector has no connection to name: it samples whatever is open, on its
// own timer, with nobody looking. Zero means "the active one" to the id-keyed
// connection source, which is the one place that reading is correct - every
// other caller comes from a page that knows which connection it is showing.
func sampleActiveConnection(service *cluster.Service) collector.Sampler {
	return samplerFunc(func(ctx context.Context) error {
		return service.CollectTPSSample(ctx, 0)
	})
}

type samplerFunc func(context.Context) error

func (f samplerFunc) CollectTPSSample(ctx context.Context) error { return f(ctx) }
