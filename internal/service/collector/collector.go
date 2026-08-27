// Package collector samples cluster metrics on a timer inside the Go process.
//
// Every other refresh in the application is driven by a renderer interval, so
// history stops accruing the moment the window is hidden to the system tray or
// the user navigates away from the overview page. This collector keeps the TPS
// history filling in regardless of what - if anything - is on screen.
package collector

import (
	"log"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/rocketmq"
)

// DefaultInterval matches the one-minute buckets the TPS history stores.
// Sampling more often would only overwrite the current bucket.
const DefaultInterval = time.Minute

// Sampler is the metric collection the ticker drives.
type Sampler interface {
	CollectTPSSample() error
}

// Collector periodically samples an already-connected cluster.
type Collector struct {
	sampler  Sampler
	interval time.Duration
	// hasClient reports whether a connection is already open. Injectable so the
	// tests do not need the process-wide client manager.
	hasClient func() bool

	startOnce sync.Once
	stopOnce  sync.Once
	stop      chan struct{}
	done      chan struct{}

	// failing is only ever touched by the sampling goroutine.
	failing bool
}

// New creates a collector that samples at DefaultInterval.
func New(sampler Sampler) *Collector {
	return newWithInterval(sampler, DefaultInterval)
}

func newWithInterval(sampler Sampler, interval time.Duration) *Collector {
	return &Collector{
		sampler:   sampler,
		interval:  interval,
		hasClient: rocketmq.GetClientManager().HasActiveDefaultClient,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start begins sampling in the background. Calling it more than once is a no-op.
func (c *Collector) Start() {
	c.startOnce.Do(func() {
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
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		log.Print("[Collector] timed out waiting for the sampler to stop")
	}
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

	if err := c.sampler.CollectTPSSample(); err != nil {
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
