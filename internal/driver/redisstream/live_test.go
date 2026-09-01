package redisstream

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// The addresses and credentials tests/e2e/redis and tests/e2e/redis-cluster
// publish. They are constants rather than environment variables because the
// compose files are the source of truth and a second place to configure them
// is a second place to get them wrong.
const (
	liveAddr        = "127.0.0.1:6479"
	liveClusterAddr = "127.0.0.1:6500"
	liveUser        = "mqstudio"
	livePassword    = "mqstudio"
	// liveReadonlyUser is declared in tests/e2e/redis/users.acl with
	// +@read +@connection and ~mqs-seed:*, which is what makes a real NOPERM
	// reachable.
	liveReadonlyUser     = "mqs-seed-readonly"
	liveReadonlyPassword = "readonly"
)

// requireRedis gates on the standalone environment.
//
// Locally it skips with the command that starts it; in CI it fails, because a
// contract test that can silently not run asserts nothing. See internal/e2e.
func requireRedis(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "redis",
		Start: "npm run e2e:redis:up",
		Probe: e2e.DialTCP(liveAddr),
	})
}

func requireRedisCluster(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the redis cluster",
		Start: "npm run e2e:redis:cluster:up",
		Probe: e2e.DialTCP(liveClusterAddr),
	})
}

// liveConn opens a connection to the standalone environment, through the same
// Open the app uses.
func liveConn(t *testing.T, options map[string]string, secrets map[string]string) *Conn {
	t.Helper()
	requireRedis(t)
	return openLive(t, liveAddr, options, secrets)
}

func openLive(t *testing.T, addr string, options map[string]string, secrets map[string]string) *Conn {
	t.Helper()
	p := model.ConnectionProfile{
		Name:      "redis-live",
		Kind:      model.KindRedisStream,
		Endpoints: addr,
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	for key, value := range options {
		p.Options[key] = value
	}
	if secrets == nil {
		secrets = map[string]string{SecretUsername: liveUser, SecretPassword: livePassword}
	}
	for key, value := range secrets {
		p.SetSecret(key, value)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	opened, err := New().Open(ctx, p)
	if err != nil {
		t.Fatalf("open %s: %v", addr, err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	return opened.(*Conn)
}

func liveContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestLiveConnectionPings(t *testing.T) {
	conn := liveConn(t, nil, nil)
	if err := conn.Ping(liveContext(t)); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

// The cluster is dialled through one address, which is the case the
// IsClusterMode flag exists for: without it go-redis would build a plain
// client that answers MOVED for most of the keyspace and never follows it.
func TestLiveClusterConnectionPings(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		// The cluster runs on requirepass, so the default user with a
		// password is the whole credential.
		map[string]string{SecretPassword: livePassword})

	ctx := liveContext(t)
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	// Six nodes, not one. A plain client dialled at the same address answers
	// PING just as happily, so the ping above does not on its own prove the
	// cluster client was built.
	nodes, err := conn.client.ClusterNodes(ctx).Result()
	if err != nil {
		t.Fatalf("cluster nodes: %v", err)
	}
	if lines := strings.Count(strings.TrimSpace(nodes), "\n") + 1; lines != 6 {
		t.Errorf("cluster reports %d nodes, want 6:\n%s", lines, nodes)
	}
}

// A key that does not live on the node dialled has to come back through a
// MOVED redirect the client follows. This is what the announced addresses in
// tests/e2e/redis-cluster/cluster.sh exist for, and it is the one thing a
// single-server environment cannot check.
func TestLiveClusterFollowsRedirects(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		map[string]string{SecretPassword: livePassword})
	ctx := liveContext(t)

	// Six keys that hash to different slots between them, so at least some
	// are owned by a node other than the one the client dialled.
	for _, suffix := range []string{"a", "b", "c", "d", "e", "f"} {
		key := "mqs-live-redirect:" + suffix
		if err := conn.client.Set(ctx, key, suffix, time.Minute).Err(); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
		t.Cleanup(func() { _ = conn.client.Del(context.Background(), key).Err() })
	}
}

/*
 * The degrade classification, against errors a real server produced.
 *
 * degradeReason is pinned by a table in degrade_test.go, and that table builds
 * its own error values - so it proves the branches are wired to the right
 * reasons and nothing about whether those prefixes are what Redis actually
 * sends. This is the other half, and it is the half that would catch a server
 * release rewording a reply.
 */
func TestLiveRejectedCredentialReadsAsTheCredential(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: liveUser,
		SecretPassword: "not-the-password",
	})

	err := conn.Ping(liveContext(t))
	if err == nil {
		t.Fatal("ping succeeded with the wrong password")
	}
	if got := degradeReason(err); got != credentialsRejected {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsRejected)
	}
}

func TestLiveUnknownUserReadsAsTheCredential(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: "nobody",
		SecretPassword: "whatever",
	})

	err := conn.Ping(liveContext(t))
	if err == nil {
		t.Fatal("ping succeeded as a user that does not exist")
	}
	if got := degradeReason(err); got != credentialsRejected {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsRejected)
	}
}

// A credential the server accepts, with an ACL that refuses the command. It is
// a different fix in a different place from a wrong password, and the only way
// to be sure Redis still says NOPERM is to make it say so.
func TestLiveForbiddenCommandReadsAsForbidden(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: liveReadonlyUser,
		SecretPassword: liveReadonlyPassword,
	})
	ctx := liveContext(t)

	// The readonly user connects and reads; it holds +@read, so a write is
	// what it cannot do.
	if err := conn.Ping(ctx); err != nil {
		e2e.Missing(t, "the %s user cannot connect; check tests/e2e/redis/users.acl (%v)", liveReadonlyUser, err)
	}
	err := conn.client.XAdd(ctx, &redis.XAddArgs{
		Stream: "mqs-live-denied",
		Values: map[string]any{"denied": "1"},
	}).Err()
	if err == nil {
		t.Fatal("the readonly user was allowed to write")
	}
	if got := degradeReason(err); got != credentialsForbidden {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsForbidden)
	}
}

// Nothing is declared yet, so a healthy connection declares nothing and a
// broken one degrades nothing. Both halves are worth pinning: this is the
// state every later capability is added on top of.
func TestLiveConnectionDeclaresNothingYet(t *testing.T) {
	conn := liveConn(t, nil, nil)
	capabilities := conn.Capabilities()
	if got := len(capabilities.Supported); got != 0 {
		t.Errorf("a live connection declares %d capabilities, want none yet", got)
	}
	if got := len(capabilities.Degraded); got != 0 {
		t.Errorf("a live connection degrades %d capabilities, want none yet", got)
	}
}
