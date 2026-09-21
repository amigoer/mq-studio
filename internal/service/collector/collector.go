// Package collector samples cluster metrics on a timer inside the Go process.
//
// Every other refresh in the application is driven by a renderer interval, so
// history stops accruing the moment the window is hidden to the system tray or
// the user navigates away from the overview page. This collector keeps the TPS
// history filling in regardless of what - if anything - is on screen.
package collector

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// DefaultInterval matches the one-minute buckets the TPS history stores.
// Sampling more often would only overwrite the current bucket.
const DefaultInterval = time.Minute

// Sampler is the metric collection the ticker drives.
type Sampler interface {
	CollectTPSSample(ctx context.Context) error
}

// ConnectionProbe reports whether any connection is open.
//
// It must never dial: an absent connection means the user closed it
// deliberately, and sampling has no business reopening it.
type ConnectionProbe func() bool

// Collector periodically samples an already-connected cluster.
type Collector struct {
	sampler  Sampler
	interval time.Duration
	// hasClient reports whether a connection is already open.
	hasClient ConnectionProbe

	startOnce sync.Once
	stopOnce  sync.Once
	stop      chan struct{}
	done      chan struct{}
	// started separates "the sampler is stopping" from "there was never a
	// sampler". Only the first has a goroutine to wait for.
	started atomic.Bool

	// failing is only ever touched by the sampling goroutine.
	failing bool
}

// New creates a collector that samples at DefaultInterval.
func New(sampler Sampler, connected ConnectionProbe) *Collector {
	return newWithInterval(sampler, connected, DefaultInterval)
}

func newWithInterval(sampler Sampler, connected ConnectionProbe, interval time.Duration) *Collector {
	return &Collector{
		sampler:   sampler,
		interval:  interval,
		hasClient: connected,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start begins sampling in the background. Calling it more than once is a no-op.
func (c *Collector) Start() {
	c.startOnce.Do(func() {
		c.started.Store(true)
		go c.loop()
	})
}

// Stop halts sampling and waits for the in-flight sample to finish.
func (c *Collector) Stop() {
	stopped := false
	c.stopOnce.Do(func() {
		close(c.stop)
		stopped = true
	})
	if !stopped {
		return
	}
	// A collector that was never started has no sampler to wait for. A process
	// that does not sample - the MCP server is one - would otherwise pay the
	// timeout below on every exit, and log a stall that never happened.
	if !c.started.Load() {
		return
	}
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		log.Print("[Collector] timed out waiting for the sampler to stop")
	}
}

// Sampling reports whether the next tick will collect anything. It answers
// the tray's question - is the background work the hidden window exists for
// actually happening - which the connection count alone does not, since the
// probe only sees the one family the sampler can read.
func (c *Collector) Sampling() bool {
	return c.hasClient != nil && c.hasClient()
}

func (c *Collector) loop() {
	defer close(c.done)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stop:
			return
		case <-ticker.C:
			c.sample()
		}
	}
}

func (c *Collector) sample() {
	// Never dial on the collector's behalf: an absent client means the user
	// has no connection open, and sampling must not create one.
	if !c.hasClient() {
		return
	}

	if err := c.sampler.CollectTPSSample(context.Background()); err != nil {
		// Log the start of a failure streak only, so a long outage does not
		// fill the log with one identical line per minute.
		if !c.failing {
			c.failing = true
			log.Printf("[Collector] background sampling failed: %v", err)
		}
		return
	}
	if c.failing {
		c.failing = false
		log.Print("[Collector] background sampling recovered")
	}
}
