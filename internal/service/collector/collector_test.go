package collector

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeSampler struct {
	mu    sync.Mutex
	calls int
	err   error
	fired chan struct{}
}

func newFakeSampler() *fakeSampler {
	return &fakeSampler{fired: make(chan struct{}, 8)}
}

func (f *fakeSampler) CollectTPSSample(context.Context) error {
	f.mu.Lock()
	f.calls++
	err := f.err
	f.mu.Unlock()
	select {
	case f.fired <- struct{}{}:
	default:
	}
	return err
}

func (f *fakeSampler) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// The collector must never dial on its own behalf. With no live default client
// the ticker has to stay quiet, otherwise hiding to the tray would silently
// reopen a connection the user closed.
func TestCollectorSkipsSamplingWithoutActiveClient(t *testing.T) {
	sampler := newFakeSampler()
	collector := newWithInterval(sampler, offline, 5*time.Millisecond)
	collector.Start()
	defer collector.Stop()

	time.Sleep(60 * time.Millisecond)
	if got := sampler.callCount(); got != 0 {
		t.Fatalf("sampler ran %d times without an active client", got)
	}
}

func TestCollectorSamplesOnTick(t *testing.T) {
	sampler := newFakeSampler()
	collector := newWithInterval(sampler, offline, 5*time.Millisecond)
	collector.hasClient = online
	collector.Start()
	defer collector.Stop()

	select {
	case <-sampler.fired:
	case <-time.After(2 * time.Second):
		t.Fatal("sampler was never invoked")
	}
}

// A failing sampler must not stop the loop: transient outages have to recover
// on their own once the cluster comes back.
func TestCollectorKeepsTickingAfterFailure(t *testing.T) {
	sampler := newFakeSampler()
	sampler.err = errors.New("cluster unreachable")
	collector := newWithInterval(sampler, offline, 5*time.Millisecond)
	collector.hasClient = online
	collector.Start()
	defer collector.Stop()

	for range 2 {
		select {
		case <-sampler.fired:
		case <-time.After(2 * time.Second):
			t.Fatal("collector stopped ticking after a failure")
		}
	}
}

func TestCollectorStopIsIdempotent(t *testing.T) {
	collector := newWithInterval(newFakeSampler(), offline, time.Hour)
	collector.Start()
	collector.Stop()
	collector.Stop()
}

// offline and online stand in for the registry probe the collector is given
// in production.
func offline() bool { return false }
func online() bool  { return true }
