package update

import (
	"context"
	"errors"
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

// manifestServer stands one mirror up over TLS, which is what Mirror.Valid
// insists on and what a real mirror is.
func manifestServer(t *testing.T, status int, body string) (Mirror, *http.Client) {
	t.Helper()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if agent := r.Header.Get("User-Agent"); agent != userAgent {
			t.Errorf("User-Agent header = %q", agent)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	mirror := Mirror{
		Name:        "test",
		ManifestURL: server.URL + "/latest.json",
		AssetBase:   server.URL,
	}
	return mirror, server.Client()
}

// manifestJSON is the smallest manifest that passes every check.
func manifestJSON(version string) string {
	name := "mq-studio-" + version + "-mac-arm64.dmg"
	return `{"schema":1,"version":"` + version + `","tag":"v` + version + `",` +
		`"notes":"## What changed","publishedAt":"2026-08-30T00:00:00Z",` +
		`"releaseURL":"https://github.com/amigoer/mq-studio/releases/tag/v` + version + `",` +
		`"files":{"` + name + `":{"path":"v` + version + `/` + name + `","size":17,` +
		`"sha256":"` + strings.Repeat("a", hexSHA256) + `"}}}`
}

func TestCheckLatestReportsStatus(t *testing.T) {
	cases := []struct {
		current, latest string
		want            Status
	}{
		{"1.4.0", "1.5.0", StatusAvailable},
		{"1.4.0", "1.4.0", StatusCurrent},
		{"2.0.0", "1.4.0", StatusAhead},
	}
	for _, testCase := range cases {
		mirror, client := manifestServer(t, http.StatusOK, manifestJSON(testCase.latest))
		result, err := CheckLatest(context.Background(), testCase.current, client, []Mirror{mirror})
		if err != nil {
			t.Fatalf("CheckLatest(%q) error = %v", testCase.current, err)
		}
		if result.Status != testCase.want {
			t.Fatalf("CheckLatest(%q) status = %q, want %q", testCase.current, result.Status, testCase.want)
		}
		if result.CurrentVersion != testCase.current {
			t.Fatalf("current version = %q, want %q", result.CurrentVersion, testCase.current)
		}
		if result.LatestVersion != testCase.latest {
			t.Fatalf("latest version = %q, want %q", result.LatestVersion, testCase.latest)
		}
	}
}

// The download that follows starts from whichever mirror answered, so the
// answer has to carry it.
func TestCheckLatestReportsTheMirrorThatAnswered(t *testing.T) {
	mirror, client := manifestServer(t, http.StatusOK, manifestJSON("1.5.0"))
	result, err := CheckLatest(context.Background(), "1.4.0", client, []Mirror{mirror})
	if err != nil {
		t.Fatalf("CheckLatest() error = %v", err)
	}
	if result.Mirror.Name != "test" {
		t.Fatalf("mirror = %q, want the one that served the manifest", result.Mirror.Name)
	}
	if len(result.Order) != 1 || result.Order[0].Name != "test" {
		t.Fatalf("order = %v, want the winner first", result.Order)
	}
	if len(result.Manifest.Files) != 1 {
		t.Fatalf("files = %v, want the manifest to reach the caller", result.Manifest.Files)
	}
}

func TestCheckLatestRejectsFailedResponses(t *testing.T) {
	mirror, client := manifestServer(t, http.StatusForbidden, `{}`)
	_, err := CheckLatest(context.Background(), "1.4.0", client, []Mirror{mirror})
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("CheckLatest error = %v", err)
	}
}

func TestCheckLatestRejectsMalformedManifests(t *testing.T) {
	cases := []struct {
		name, body, want string
	}{
		{"not JSON", `not json at all`, "unreadable release index"},
		{"no schema", `{"version":"1.5.0","files":{}}`, "does not say which schema"},
		{"prerelease version", `{"schema":1,"version":"1.5.0-beta.1","files":{}}`, "no stable version"},
		{"no packages", `{"schema":1,"version":"1.5.0","files":{}}`, "lists no packages"},
		{
			"package with no digest",
			`{"schema":1,"version":"1.5.0","files":{"a.dmg":{"path":"v1.5.0/a.dmg"}}}`,
			"no usable checksum",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			mirror, client := manifestServer(t, http.StatusOK, testCase.body)
			_, err := CheckLatest(context.Background(), "1.4.0", client, []Mirror{mirror})
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("CheckLatest error = %v, want it to mention %q", err, testCase.want)
			}
		})
	}
}

// A manifest from the future cannot be read by guessing at it, and it will not
// read any better from another mirror - so it has to stop the check with
// something a user can act on.
func TestCheckLatestRefusesAManifestFromALaterBuild(t *testing.T) {
	mirror, client := manifestServer(t, http.StatusOK, `{"schema":99,"version":"9.0.0"}`)
	_, err := CheckLatest(context.Background(), "1.4.0", client, []Mirror{mirror})
	if !errors.Is(err, ErrSchemaTooNew) {
		t.Fatalf("CheckLatest error = %v, want ErrSchemaTooNew", err)
	}
	if !strings.Contains(err.Error(), DownloadsURL) {
		t.Errorf("error = %v, want it to point at the downloads page", err)
	}
}
