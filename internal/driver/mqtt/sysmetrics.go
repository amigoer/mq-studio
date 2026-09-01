package mqtt

import (
	"context"
	"strconv"
	"strings"
	"time"
)

/*
 * The $SYS tree: a broker reporting on itself over its own protocol.
 *
 * It is a convention rather than part of the specification, which is why the
 * driver probes for it instead of assuming it. Two brokers show both halves of
 * that: Mosquitto publishes a full tree of counters under $SYS/broker and has
 * no other management plane at all, while EMQX's default authorisation refuses
 * a remote client's subscription to $SYS outright and expects its REST API to
 * be used instead.
 *
 * So this reads whatever arrives rather than requiring a shape. Every topic is
 * kept verbatim for the overview's own table, and a small canonical set is
 * mapped out of it for the figures the board shows as numbers. A key that is
 * not there produces UnknownMetric, never a zero: "this broker does not report
 * dropped messages" and "no messages were dropped" are different claims.
 */

const (
	// sysFilter is the whole tree. It has to be spelled with the $ prefix,
	// because the specification's own rule is that a leading wildcard does not
	// match it - which is exactly what keeps $SYS out of the workbench.
	sysFilter = "$SYS/#"

	// sysWindow bounds a read. Mosquitto publishes its tree retained, so a
	// subscriber has every current value within a round trip; this is the
	// ceiling for a broker that answers more slowly, and the whole cost on one
	// that publishes no tree at all.
	sysWindow = 2 * time.Second

	// sysQuiet ends a read once the tree has stopped arriving, the same way a
	// retained topic listing ends. The tree comes as one burst.
	sysQuiet = 200 * time.Millisecond

	// mosquittoPrefix is the tree Mosquitto and its imitators publish. EMQX
	// uses "$SYS/brokers/<node>/" instead, which this driver keeps verbatim
	// rather than mapping: its numbers are read from the REST API, where they
	// are complete, rather than from a tree its default configuration refuses
	// to serve.
	mosquittoPrefix = "$SYS/broker/"
)

// The $SYS keys this driver reads by name, relative to mosquittoPrefix. They
// are what a live Mosquitto publishes, checked against the broker rather than
// against its documentation.
const (
	sysVersion             = "version"
	sysUptime              = "uptime"
	sysClientsConnected    = "clients/connected"
	sysClientsTotal        = "clients/total"
	sysClientsMaximum      = "clients/maximum"
	sysClientsInactive     = "clients/inactive"
	sysClientsExpired      = "clients/expired"
	sysSubscriptions       = "subscriptions/count"
	sysSharedSubscriptions = "shared_subscriptions/count"
	// The space is Mosquitto's, not a typo.
	sysRetained         = "retained messages/count"
	sysMessagesReceived = "messages/received"
	sysMessagesSent     = "messages/sent"
	sysMessagesStored   = "messages/stored"
	sysMessagesDropped  = "publish/messages/dropped"
	sysBytesReceived    = "bytes/received"
	sysBytesSent        = "bytes/sent"
	sysLoadIn1min       = "load/messages/received/1min"
	sysLoadOut1min      = "load/messages/sent/1min"
	sysHeapCurrent      = "heap/current"
)

// sysTree is one read of the broker's own tree.
type sysTree struct {
	// Values are every $SYS topic that answered, keyed by the whole topic
	// name. The overview shows them as a table, so nothing is discarded for
	// not being recognised.
	Values map[string]string
	// Mosquitto says whether the tree had the shape whose keys this driver
	// reads by name.
	Mosquitto bool
}

// readSys subscribes to the whole tree and gathers what the broker replays.
//
// A refusal comes back as an error rather than an empty tree: EMQX's default
// authorisation denies the subscription, and reporting that as "the broker
// publishes nothing" would send an operator looking for a configuration
// setting that is already correct.
func (c *Conn) readSys(ctx context.Context) (*sysTree, error) {
	if c.client == nil {
		return nil, errConnectionDown
	}

	// A profile with a short timeout must not spend longer than that waiting
	// for a tree that may not exist: this read is the whole cost of opening a
	// connection to a broker that publishes no $SYS.
	window := sysWindow
	if c.config.DialTimeout > 0 && c.config.DialTimeout < window {
		window = c.config.DialTimeout
	}

	collector := &retainedCollector{
		messages: make(map[string]inboundMessage),
		quiet:    time.NewTimer(window),
		quietFor: sysQuiet,
		// $SYS values arrive as ordinary publishes on some brokers and as
		// retained ones on others, so this collection takes both.
		anyMessage: true,
	}
	defer collector.quiet.Stop()

	c.collectMu.Lock()
	c.collector = collector
	c.collectMu.Unlock()
	defer func() {
		c.collectMu.Lock()
		c.collector = nil
		c.collectMu.Unlock()
	}()

	if err := c.client.Subscribe(ctx, []subscribeFilter{{Pattern: sysFilter}}); err != nil {
		return nil, err
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), c.config.DialTimeout)
		defer cancel()
		_ = c.client.Unsubscribe(stopCtx, []string{sysFilter})
	}()

	// The quiet timer starts at the window, so it doubles as the ceiling when
	// nothing arrives at all.
	collector.quiet.Reset(window)
	deadline := time.NewTimer(window)
	defer deadline.Stop()
	select {
	case <-collector.done():
	case <-deadline.C:
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	tree := &sysTree{Values: make(map[string]string)}
	for topic, message := range collector.collected() {
		tree.Values[topic] = string(message.Payload)
		if strings.HasPrefix(topic, mosquittoPrefix) {
			tree.Mosquitto = true
		}
	}
	return tree, nil
}

// value reads one key relative to the Mosquitto prefix.
func (t *sysTree) value(key string) (string, bool) {
	raw, found := t.Values[mosquittoPrefix+key]
	return raw, found
}

// number reads a counter, or UnknownMetric where the broker does not publish
// one. A missing counter is not a zero.
func (t *sysTree) number(key string) int64 {
	raw, found := t.value(key)
	if !found {
		return unknown
	}
	// Mosquitto's load averages are fractional and its counters are not, so
	// both are parsed as a float and truncated rather than one path failing.
	parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return unknown
	}
	return int64(parsed)
}

// text reads a string value, empty where it is not published.
func (t *sysTree) text(key string) string {
	raw, _ := t.value(key)
	return strings.TrimSpace(raw)
}

// uptimeSeconds reads Mosquitto's uptime, which is published as "38 seconds"
// rather than as a number.
func (t *sysTree) uptimeSeconds() int64 {
	raw := t.text(sysUptime)
	if raw == "" {
		return unknown
	}
	seconds, err := strconv.ParseInt(strings.Fields(raw)[0], 10, 64)
	if err != nil {
		return unknown
	}
	return seconds
}

// empty reports a tree with nothing in it, which is a broker that accepted the
// subscription and publishes no $SYS at all.
func (t *sysTree) empty() bool { return len(t.Values) == 0 }

// unknown is model.UnknownMetric as an int64, for the counters that are one.
const unknown = int64(-1)
