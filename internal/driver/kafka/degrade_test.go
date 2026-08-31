package kafka

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"syscall"
	"testing"

	"github.com/twmb/franz-go/pkg/kerr"
)

// timeoutError is a net.Error that timed out, which is how the standard
// library reports one and how franz-go passes it on.
type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

var _ net.Error = timeoutError{}

// Four failures that look identical to a caller and are fixed in four
// different places. Collapsing any two of them sends an operator to the wrong
// one: this used to report a rejected password as "cluster unreachable", and
// people went to check firewalls.
func TestDegradeReason(t *testing.T) {
	cases := []struct {
		name           string
		err            error
		authenticating bool
		want           string
	}{
		{name: "no error", err: nil, want: ""},
		{
			name: "sasl authentication failed",
			err:  fmt.Errorf("connect: %w", kerr.SaslAuthenticationFailed),
			want: credentialsRejected,
		},
		{
			name: "an unsupported mechanism is the credential half of the form",
			err:  kerr.UnsupportedSaslMechanism,
			want: credentialsRejected,
		},
		{
			name: "an illegal sasl state is too",
			err:  kerr.IllegalSaslState,
			want: credentialsRejected,
		},
		{
			name: "authorized to connect, not to describe the cluster",
			err:  fmt.Errorf("metadata: %w", kerr.ClusterAuthorizationFailed),
			want: credentialsForbidden,
		},
		{
			name: "a deadline that expired",
			err:  fmt.Errorf("request: %w", context.DeadlineExceeded),
			want: endpointTimedOut,
		},
		{
			name: "a net.Error that timed out",
			err:  fmt.Errorf("dial: %w", timeoutError{}),
			want: endpointTimedOut,
		},
		{
			name: "refused connection",
			err:  fmt.Errorf("dial: %w", syscall.ECONNREFUSED),
			want: endpointUnreachable,
		},
		{
			name: "no such host",
			err:  errors.New("dial tcp: lookup nope: no such host"),
			want: endpointUnreachable,
		},

		// The pair that matters. A broker refusing a SASL exchange is allowed
		// to answer with an error code or to close the socket, and both
		// happen, so a bare EOF has to be read differently depending on
		// whether this profile was authenticating at all.
		{
			name:           "a dropped connection while authenticating is the credential",
			err:            io.EOF,
			authenticating: true,
			want:           credentialsRejected,
		},
		{
			name:           "a reset connection while authenticating is the credential",
			err:            fmt.Errorf("read: %w", syscall.ECONNRESET),
			authenticating: true,
			want:           credentialsRejected,
		},
		{
			name:           "the same drop without sasl is not about a credential",
			err:            io.EOF,
			authenticating: false,
			want:           endpointUnreachable,
		},
		// A port nothing listens on must never read as a wrong password, or
		// the form sends the user to re-type a credential that was fine.
		{
			name:           "a refused dial while authenticating is still the address",
			err:            fmt.Errorf("dial: %w", syscall.ECONNREFUSED),
			authenticating: true,
			want:           endpointUnreachable,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := degradeReason(test.err, test.authenticating); got != test.want {
				t.Errorf("degradeReason(%v, %t) = %q, want %q",
					test.err, test.authenticating, got, test.want)
			}
		})
	}
}

// Every reason is an i18n key the renderer resolves. A sentence here would
// reach the user in whatever language it was written in.
func TestDegradeReasonsAreTranslationKeys(t *testing.T) {
	for _, reason := range []string{
		credentialsRejected, credentialsForbidden, endpointTimedOut, endpointUnreachable,
	} {
		if !isTranslationKey(reason) {
			t.Errorf("%q does not look like an i18n key", reason)
		}
	}
}

func isTranslationKey(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '.':
		default:
			return false
		}
	}
	return true
}
