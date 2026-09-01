package pulsar

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// fakeCluster is an admin API that answers however a test needs it to, and a
// broker port that is either open or not.
//
// It exists so the connection paths that matter - a cluster that answers, one
// that rejects a token, one whose tenant is gone, one whose binary port is
// shut - are covered with nothing running.
type fakeCluster struct {
	adminURL   string
	serviceURL string
}

func newFakeCluster(t *testing.T, status int, body string) fakeCluster {
	t.Helper()

	admin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(admin.Close)

	// A real listener, because the data plane probe dials rather than asking a
	// library whether it thinks it is connected.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("open a broker port: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	return fakeCluster{
		adminURL:   admin.URL,
		serviceURL: "pulsar://" + listener.Addr().String(),
	}
}

func (f fakeCluster) config() clientConfig {
	return clientConfig{
		ServiceURL: f.serviceURL,
		AdminURL:   f.adminURL,
		Tenant:     defaultTenant,
		Namespace:  defaultNamespace,
		Timeout:    2 * time.Second,
	}
}

func probedConn(t *testing.T, config clientConfig) *Conn {
	t.Helper()

	admin, transport, err := newAdmin(config)
	if err != nil {
		t.Fatalf("newAdmin: %v", err)
	}
	client, err := newDataPlane(config)
	if err != nil {
		t.Fatalf("newDataPlane: %v", err)
	}
	conn := newConn(admin, client, transport, config)
	t.Cleanup(func() { _ = conn.Close() })

	conn.probe(context.Background())
	return conn
}

// A cluster that answers is the baseline: nothing is degraded, so the sidebar
// draws whatever the capability list says and no page carries an explanation
// it does not need.
func TestProbeDegradesNothingAgainstAClusterThatAnswers(t *testing.T) {
	cluster := newFakeCluster(t, http.StatusOK, `["public/default"]`)
	conn := probedConn(t, cluster.config())

	if len(conn.Capabilities().Degraded) != 0 {
		t.Errorf("a healthy cluster degraded %v", conn.Capabilities().Degraded)
	}
}

/*
 * Whatever the admin plane refuses, it refuses for a reason the user can act
 * on - and the reason has to survive the probe.
 *
 * The probe is the only place these are computed. A capability degraded with
 * an empty reason renders as a disabled control with no tooltip, which is
 * indistinguishable from a bug in the app.
 */
func TestProbeReportsWhyTheAdminPlaneRefused(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   string
	}{
		{name: "a rejected token", status: http.StatusUnauthorized, want: credentialsRejected},
		{name: "a role with no permission", status: http.StatusForbidden, want: credentialsForbidden},
		{name: "a tenant that is not there", status: http.StatusNotFound, want: tenantMissing},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			cluster := newFakeCluster(t, test.status, `{"reason":"no"}`)
			conn := probedConn(t, cluster.config())

			for _, capability := range capabilities() {
				reason, degraded := conn.Capabilities().DegradedReason(capability)
				if !degraded {
					t.Errorf("%s survived an admin plane that answered %d",
						capability, test.status)
					continue
				}
				if reason != test.want {
					t.Errorf("%s degraded with %q, want %q", capability, reason, test.want)
				}
			}
		})
	}
}

/*
 * The two planes fail separately, so they degrade separately.
 *
 * A cluster whose web service is behind an ingress and whose broker port is
 * not is a routine deployment. Taking the admin pages away because the binary
 * port is shut would hide every listing the connection can still serve.
 */
func TestProbeKeepsAdminCapabilitiesWhenOnlyTheDataPlaneIsDown(t *testing.T) {
	cluster := newFakeCluster(t, http.StatusOK, `["public/default"]`)
	config := cluster.config()
	// A port nothing is listening on. Port 1 is reserved and never bound.
	config.ServiceURL = "pulsar://127.0.0.1:1"

	conn := probedConn(t, config)

	dataPlane := make(map[model.Capability]bool, len(dataPlaneCapabilities()))
	for _, capability := range dataPlaneCapabilities() {
		dataPlane[capability] = true
		reason, degraded := conn.Capabilities().DegradedReason(capability)
		if !degraded {
			t.Errorf("%s survived a broker port that is shut", capability)
			continue
		}
		if reason != dataPlaneUnreachable {
			t.Errorf("%s degraded with %q, want %q", capability, reason, dataPlaneUnreachable)
		}
	}

	for _, capability := range capabilities() {
		if dataPlane[capability] {
			continue
		}
		if _, degraded := conn.Capabilities().DegradedReason(capability); degraded {
			t.Errorf("%s is served over HTTP and was degraded by a shut broker port", capability)
		}
	}
}

// Close is called on both disconnect and shutdown, so the second call has to
// be the one that does nothing. pulsar-client-go's Close is not documented as
// repeatable, and a panic here would take the app down on quit.
func TestCloseIsRepeatable(t *testing.T) {
	cluster := newFakeCluster(t, http.StatusOK, `["public/default"]`)
	conn := probedConn(t, cluster.config())

	if err := conn.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
}
