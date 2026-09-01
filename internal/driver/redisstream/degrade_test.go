package redisstream

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"testing"

	"github.com/redis/go-redis/v9"
)

// timeoutError is a net.Error that timed out, which is how the standard
// library reports one and how go-redis passes it on.
type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

var _ net.Error = timeoutError{}

// serverError is an error reply from Redis, as far as the classification can
// tell. go-redis models one as a value satisfying redis.Error, and
// HasErrorPrefix matches on that interface - so a test can produce the same
// shape without reaching into the library's internals, and exercises the same
// branch a real reply takes.
type serverError string

func (e serverError) Error() string { return string(e) }
func (e serverError) RedisError()   {}

var _ redis.Error = serverError("")

func redisError(message string) error { return serverError(message) }

// Six failures that look identical to a caller - every capability goes away -
// and are fixed in six different places. The pair worth the most care is the
// first two: a wrong password and a password sent to a server that wants none
// are both authentication failures to Redis, and telling someone to correct a
// credential they should be deleting is a wasted afternoon.
func TestDegradeReason(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{name: "no error", err: nil, want: ""},
		{
			name: "a wrong username and password pair",
			err:  fmt.Errorf("ping: %w", redisError("WRONGPASS invalid username-password pair or user is disabled.")),
			want: credentialsRejected,
		},
		{
			name: "a server that wants a credential and got none",
			err:  redisError("NOAUTH Authentication required."),
			want: credentialsRejected,
		},
		{
			name: "a password sent to a server that has none is not a wrong password",
			err:  redisError("ERR Client sent AUTH, but no password is set. Did you mean AUTH <username> <password>?"),
			want: credentialsNotRequired,
		},
		{
			name: "a credential the server accepted, with an acl that refuses the command",
			err:  redisError("NOPERM User mqs-seed-readonly has no permissions to run the 'xadd' command"),
			want: credentialsForbidden,
		},
		{
			name: "a server still reading its dataset off disk",
			err:  redisError("LOADING Redis is loading the dataset in memory"),
			want: serverLoading,
		},
		{
			name: "a deadline that expired",
			err:  fmt.Errorf("request: %w", context.DeadlineExceeded),
			want: endpointTimedOut,
		},
		{
			name: "a host that accepted the connection and went quiet",
			err:  fmt.Errorf("read: %w", timeoutError{}),
			want: endpointTimedOut,
		},
		{
			name: "nothing listening",
			err:  errors.New("dial tcp 127.0.0.1:6379: connect: connection refused"),
			want: endpointUnreachable,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := degradeReason(tc.err); got != tc.want {
				t.Errorf("degradeReason(%v) = %q, want %q", tc.err, got, tc.want)
			}
		})
	}
}

/*
 * The reasons cross the bridge and are resolved by the renderer, so they have
 * to be keys rather than sentences.
 *
 * A driver that returned English here would put that English on screen for
 * every user in every language, and it would look deliberate. The renderer has
 * no way to tell a key it cannot resolve from a message meant to be shown.
 */
func TestDegradeReasonsAreTranslationKeys(t *testing.T) {
	key := regexp.MustCompile(`^[a-zA-Z][a-zA-Z.-]*$`)
	reasons := map[string]string{
		"credentialsRejected":    credentialsRejected,
		"credentialsNotRequired": credentialsNotRequired,
		"credentialsForbidden":   credentialsForbidden,
		"serverLoading":          serverLoading,
		"endpointTimedOut":       endpointTimedOut,
		"endpointUnreachable":    endpointUnreachable,
	}
	for name, reason := range reasons {
		if !key.MatchString(reason) {
			t.Errorf("%s = %q, which is not a translation key", name, reason)
		}
	}
}
