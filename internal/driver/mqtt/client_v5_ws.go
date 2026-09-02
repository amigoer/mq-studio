package mqtt

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/eclipse/paho.golang/autopaho"
)

/*
 * MQTT 5.0 over WebSocket, with the packet kept in one frame.
 *
 * autopaho ships its own WebSocket adapter and it fragments. paho writes a
 * control packet through net.Buffers, whose WriteTo calls Write once per
 * buffer, and that adapter turns every Write into its own WebSocket message -
 * so a PUBLISH leaves as three messages, its fixed header in the first. A
 * broker reads the first as a whole packet whose remaining length promises
 * bytes that never come in it.
 *
 * Mosquitto answers "malformed packet" and drops the connection; autopaho
 * reconnects, so the session looks up while every round trip that needs an
 * acknowledgement times out. A live test found it - the in-process broker
 * tolerates the fragments, and MQTT 3.1.1 goes through a different library
 * entirely, so nothing else here could have.
 *
 * The fix uses the hook paho already provides. ControlPacket.WriteTo locks the
 * connection for the whole packet when the writer is a sync.Locker, so
 * buffering between Lock and Unlock and flushing once gives exactly one frame
 * per packet.
 */

// wsDial is autopaho's connection hook. Supplying it replaces the built-in
// dialler for every scheme, so the plain and TLS cases are handled here too.
func wsDial(config clientConfig) func(context.Context, autopaho.ClientConfig, *url.URL) (net.Conn, error) {
	return func(ctx context.Context, _ autopaho.ClientConfig, server *url.URL) (net.Conn, error) {
		switch server.Scheme {
		case "ws", "wss":
			return dialWebSocket(ctx, server, config.TLS)
		case "mqtts", "ssl", "tls":
			dialer := &tls.Dialer{NetDialer: &net.Dialer{}, Config: config.TLS}
			return dialer.DialContext(ctx, "tcp", server.Host)
		default:
			return (&net.Dialer{}).DialContext(ctx, "tcp", server.Host)
		}
	}
}

func dialWebSocket(ctx context.Context, server *url.URL, tlsConfig *tls.Config) (net.Conn, error) {
	dialer := *websocket.DefaultDialer
	dialer.TLSClientConfig = tlsConfig
	// The subprotocol is not optional: a broker that does not see "mqtt" is
	// entitled to refuse the upgrade, and several do.
	dialer.Subprotocols = []string{"mqtt"}

	socket, _, err := dialer.DialContext(ctx, server.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("websocket connection failed: %w", err)
	}
	return &wsConn{Conn: socket}, nil
}

// wsConn presents a WebSocket as a net.Conn that writes one frame per MQTT
// packet.
type wsConn struct {
	*websocket.Conn

	// writeMu is held for the whole of one packet, because it is what paho
	// takes through the sync.Locker below.
	writeMu sync.Mutex
	// buffering is true between Lock and Unlock, which is the span of one
	// control packet.
	buffering bool
	pending   []byte
	// flushErr carries a failure from Unlock, which cannot return one. It
	// surfaces on the next write, and the read side fails alongside it.
	flushErr error

	readMu sync.Mutex
	reader io.Reader
}

// Lock starts a packet. paho calls it before writing one and Unlock after.
func (c *wsConn) Lock() {
	c.writeMu.Lock()
	c.buffering = true
	c.pending = c.pending[:0]
}

// Unlock ends the packet and sends it as a single frame.
func (c *wsConn) Unlock() {
	if len(c.pending) > 0 {
		if err := c.Conn.WriteMessage(websocket.BinaryMessage, c.pending); err != nil && c.flushErr == nil {
			c.flushErr = err
		}
	}
	c.buffering = false
	c.pending = c.pending[:0]
	c.writeMu.Unlock()
}

// Write buffers within a packet, and sends immediately outside one.
func (c *wsConn) Write(p []byte) (int, error) {
	if c.buffering {
		if c.flushErr != nil {
			return 0, c.flushErr
		}
		c.pending = append(c.pending, p...)
		return len(p), nil
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.flushErr != nil {
		return 0, c.flushErr
	}
	if err := c.Conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Read draws from the current frame, advancing to the next when it is spent.
// A packet may legitimately span frames on the way in, which is why this reads
// across them rather than treating a frame as a packet.
func (c *wsConn) Read(p []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()

	for {
		if c.reader == nil {
			_, reader, err := c.Conn.NextReader()
			if err != nil {
				return 0, err
			}
			c.reader = reader
		}
		read, err := c.reader.Read(p)
		if err == io.EOF {
			c.reader = nil
			if read > 0 {
				return read, nil
			}
			continue
		}
		return read, err
	}
}

// SetDeadline sets both, which net.Conn requires and a WebSocket splits.
func (c *wsConn) SetDeadline(deadline time.Time) error {
	if err := c.Conn.SetReadDeadline(deadline); err != nil {
		return err
	}
	return c.Conn.SetWriteDeadline(deadline)
}
