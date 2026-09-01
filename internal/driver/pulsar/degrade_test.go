package pulsar

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/rest"
)

// timeoutError is what a transport reports when a host accepted the
// connection and went quiet. net.Error is an interface, so the only way to
// produce one in a unit test is to implement it.
type timeoutError struct{}

func (timeoutError) Error() string { return "i/o timeout" }
func (timeoutError) Timeout() bool { return true }

/*
 * Five failures that look identical to a caller and are fixed in five
 * different places.
 *
 * Every one of them takes the whole admin plane away, so the only thing that
 * tells an operator where to go is this string. Collapsing any two of them
 * sends someone to the wrong place: reporting a deleted tenant as
 * "unreachable" sends them to check a network that was fine, and reporting a
 * rejected token the same way sends them to check it twice.
 */
func TestDegradeReason(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{
			name: "an unauthorized response is the token",
			err:  rest.Error{Code: 401, Reason: "Unauthorized"},
			want: credentialsRejected,
		},
		{
			name: "a forbidden response is the role, not the token",
			err:  rest.Error{Code: 403, Reason: "Forbidden"},
			want: credentialsForbidden,
		},
		{
			// The probe asks one tenant for its namespaces, so this is the
			// only thing a 404 can mean on that path.
			name: "a not-found response is the tenant this profile is scoped to",
			err:  rest.Error{Code: 404, Reason: "Tenant does not exist"},
			want: tenantMissing,
		},
		{
			name: "a wrapped status is still read",
			err:  fmt.Errorf("list namespaces: %w", rest.Error{Code: 401, Reason: "Unauthorized"}),
			want: credentialsRejected,
		},
		{
			name: "a deadline is the host going quiet",
			err:  context.DeadlineExceeded,
			want: endpointTimedOut,
		},
		{
			name: "so is a transport timeout",
			err:  timeoutError{},
			want: endpointTimedOut,
		},
		{
			name: "a refused connection is nothing listening",
			err:  &net.OpError{Op: "dial", Err: errors.New("connection refused")},
			want: endpointUnreachable,
		},
		{
			// A 500 is the cluster failing rather than refusing, and there is
			// nothing more specific to say about it than "it did not answer".
			name: "an unrecognised status falls back to unreachable",
			err:  rest.Error{Code: 500, Reason: "Internal Server Error"},
			want: endpointUnreachable,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := degradeReason(test.err); got != test.want {
				t.Errorf("degradeReason(%v) = %q, want %q", test.err, got, test.want)
			}
		})
	}
}

// Every reason is an i18n key the renderer resolves. A sentence here would
// reach the user in whatever language it was written in, and the sidebar would
// draw it verbatim beside a page it disabled.
func TestDegradeReasonsAreTranslationKeys(t *testing.T) {
	reasons := []string{
		credentialsRejected,
		credentialsForbidden,
		tenantMissing,
		endpointTimedOut,
		endpointUnreachable,
		dataPlaneUnreachable,
	}

	seen := make(map[string]bool, len(reasons))
	for _, reason := range reasons {
		if !strings.HasPrefix(reason, "mq.pulsar.degraded.") {
			t.Errorf("%q is not a mq.pulsar.degraded.* key", reason)
		}
		if strings.Contains(reason, " ") {
			t.Errorf("%q is a sentence, not a key", reason)
		}
		if seen[reason] {
			t.Errorf("%q is used for two different failures", reason)
		}
		seen[reason] = true
	}
}
