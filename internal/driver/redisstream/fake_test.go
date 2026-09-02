package redisstream

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"

	"github.com/amigoer/mq-studio/internal/model"
)

// fakeServer is an in-process Redis, the counterpart of the kfake cluster the
// Kafka driver tests against. It covers the stream plane with no docker, so
// the connection paths are exercised by a plain `go test ./...`.
//
// What it cannot do decides where the rest of the coverage lives: it has no
// XGROUP SETID and no admin plane at all - INFO answers only connected_clients,
// and CLIENT, CONFIG, SLOWLOG and ACL are absent. Those belong to the live
// suite, and the tests that need them say so rather than quietly not running.
func fakeServer(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	return server
}

// fakeConn opens a connection against an in-process server, through the same
// Open the app uses, so the profile-to-client derivation is part of what is
// under test rather than bypassed.
func fakeConn(t *testing.T, server *miniredis.Miniredis, options map[string]string, secrets map[string]string) *Conn {
	t.Helper()
	p := profile(server.Addr(), options)
	for key, value := range secrets {
		p.SetSecret(key, value)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, p)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	return conn
}

func TestConnectionPingsAnInProcessServer(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if conn.Kind() != model.KindRedisStream {
		t.Errorf("kind = %q", conn.Kind())
	}
}

// Open must not fail on a broker it cannot use. A connection that comes back
// carrying the reason is what lets every page say which half is wrong; a dial
// error would leave the user with one message and no pages.
func TestOpenSucceedsAgainstARejectedCredential(t *testing.T) {
	server := fakeServer(t)
	server.RequireUserAuth("mqstudio", "correct")

	conn := fakeConn(t, server, nil, map[string]string{
		SecretUsername: "mqstudio",
		SecretPassword: "wrong",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err == nil {
		t.Fatal("ping succeeded with the wrong password")
	}
	// Nothing is declared yet, so there is nothing to degrade. What this pins
	// is that Open returned a usable connection rather than an error - the
	// degraded capability set arrives with the first port.
	if got := len(conn.Capabilities().Supported); got != 0 {
		t.Errorf("a rejected connection declares %d capabilities, want none", got)
	}
}

func TestAuthenticatedConnectionPings(t *testing.T) {
	server := fakeServer(t)
	server.RequireUserAuth("mqstudio", "correct")

	conn := fakeConn(t, server, nil, map[string]string{
		SecretUsername: "mqstudio",
		SecretPassword: "correct",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping with the right credential: %v", err)
	}
}

// The registry closes on both disconnect and shutdown, so the second call has
// to be the one that does nothing rather than an error the caller logs.
func TestCloseIsIdempotent(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
}

// A profile pointed at a database other than zero has to select it, or every
// stream the app lists is from a keyspace the user was not looking at.
func TestTheProfileDatabaseIsSelected(t *testing.T) {
	server := fakeServer(t)
	server.Select(5)
	if err := server.Set("only-in-five", "yes"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	conn := fakeConn(t, server, map[string]string{OptionDB: "5"}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	value, err := conn.client.Get(ctx, "only-in-five").Result()
	if err != nil {
		t.Fatalf("get from database 5: %v", err)
	}
	if value != "yes" {
		t.Errorf("value = %q, want yes", value)
	}
}
