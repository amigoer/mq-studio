package update

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompareStableOrdersComponentsNumerically(t *testing.T) {
	cases := []struct {
		left, right string
		want        int
	}{
		{"1.9.9", "1.10.0", -1},
		{"10.0.0", "2.99.99", 1},
		{"v1.4.0", "1.4.0+build.7", 0},
	}
	for _, testCase := range cases {
		got, err := CompareStable(testCase.left, testCase.right)
		if err != nil {
			t.Fatalf("CompareStable(%q, %q) error = %v", testCase.left, testCase.right, err)
		}
		if got != testCase.want {
			t.Fatalf("CompareStable(%q, %q) = %d, want %d", testCase.left, testCase.right, got, testCase.want)
		}
	}
}

func TestCompareStableRejectsNonStableVersions(t *testing.T) {
	for _, version := range []string{"1.4", "1.4.0-beta.1", "01.4.0", "latest"} {
		if _, err := CompareStable(version, "1.4.0"); err == nil {
			t.Fatalf("CompareStable(%q) expected an error", version)
		} else if !strings.Contains(err.Error(), "invalid stable SemVer") {
			t.Fatalf("CompareStable(%q) error = %v", version, err)
		}
	}
}

func releaseServer(t *testing.T, status int, body string) (*httptest.Server, *http.Client) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if accept := r.Header.Get("Accept"); accept != "application/vnd.github+json" {
			t.Errorf("Accept header = %q", accept)
		}
		if agent := r.Header.Get("User-Agent"); !strings.HasPrefix(agent, "Rocket-Leaf/") {
			t.Errorf("User-Agent header = %q", agent)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, &http.Client{Transport: rewriteHost{host: server.Listener.Addr().String()}}
}

// rewriteHost points the fixed GitHub API URL at the test server.
type rewriteHost struct{ host string }

func (r rewriteHost) RoundTrip(request *http.Request) (*http.Response, error) {
	request.URL.Scheme = "http"
	request.URL.Host = r.host
	return http.DefaultTransport.RoundTrip(request)
}

func TestCheckLatestReportsStatus(t *testing.T) {
	cases := []struct {
		current, tag string
		want         Status
	}{
		{"1.4.0", "v1.5.0", StatusAvailable},
		{"1.4.0", "v1.4.0", StatusCurrent},
		{"2.0.0", "v1.4.0", StatusAhead},
	}
	for _, testCase := range cases {
		_, client := releaseServer(t, http.StatusOK, `{"tag_name":"`+testCase.tag+`"}`)
		result, err := CheckLatest(testCase.current, client)
		if err != nil {
			t.Fatalf("CheckLatest(%q) error = %v", testCase.current, err)
		}
		if result.Status != testCase.want {
			t.Fatalf("CheckLatest(%q) status = %q, want %q", testCase.current, result.Status, testCase.want)
		}
		if result.CurrentVersion != testCase.current {
			t.Fatalf("current version = %q, want %q", result.CurrentVersion, testCase.current)
		}
		if want := strings.TrimPrefix(testCase.tag, "v"); result.LatestVersion != want {
			t.Fatalf("latest version = %q, want %q", result.LatestVersion, want)
		}
	}
}

func TestCheckLatestRejectsFailedResponses(t *testing.T) {
	_, client := releaseServer(t, http.StatusForbidden, `{}`)
	_, err := CheckLatest("1.4.0", client)
	if err == nil || !strings.Contains(err.Error(), "failed (403)") {
		t.Fatalf("CheckLatest error = %v", err)
	}
}

func TestCheckLatestRejectsPrereleasesAndMalformedPayloads(t *testing.T) {
	_, client := releaseServer(t, http.StatusOK, `{"tag_name":"v1.5.0-beta.1","prerelease":true}`)
	if _, err := CheckLatest("1.4.0", client); err == nil ||
		!strings.Contains(err.Error(), "not a stable release") {
		t.Fatalf("prerelease error = %v", err)
	}

	_, client = releaseServer(t, http.StatusOK, `{"name":"v1.5.0"}`)
	if _, err := CheckLatest("1.4.0", client); err == nil ||
		!strings.Contains(err.Error(), "missing tag_name") {
		t.Fatalf("malformed payload error = %v", err)
	}
}
