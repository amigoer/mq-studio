package update

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeMirror serves a manifest after a delay and counts what it was asked for.
// The count is the point: several of these tests care that a request was never
// made at all, which is a stronger claim than that it did not win.
type fakeMirror struct {
	Mirror
	hits   atomic.Int64
	server *httptest.Server
}

func newFakeMirror(t *testing.T, name string, delay time.Duration, status int, body string) *fakeMirror {
	t.Helper()
	fake := &fakeMirror{}
	fake.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.hits.Add(1)
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-r.Context().Done():
				return
			}
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(fake.server.Close)
	fake.Mirror = Mirror{
		Name:        name,
		ManifestURL: fake.server.URL + "/latest.json",
		AssetBase:   fake.server.URL,
	}
	return fake
}

// clientFor trusts exactly these servers, so one client can reach several
// mirrors without turning verification off.
func clientFor(mirrors ...*fakeMirror) *http.Client {
	pool := x509.NewCertPool()
	for _, mirror := range mirrors {
		pool.AddCert(mirror.server.Certificate())
	}
	return &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
	}}
}

func mirrorsOf(fakes ...*fakeMirror) []Mirror {
	list := make([]Mirror, 0, len(fakes))
	for _, fake := range fakes {
		list = append(list, fake.Mirror)
	}
	return list
}

// The whole reason for staggering rather than fanning out: having mirrors
// costs nothing at all until one of them is needed.
func TestRaceLeavesLaterMirrorsAloneWhenTheFirstAnswers(t *testing.T) {
	first := newFakeMirror(t, "first", 0, http.StatusOK, manifestJSON("1.5.0"))
	second := newFakeMirror(t, "second", 0, http.StatusOK, manifestJSON("1.5.0"))

	fetched, err := RaceManifest(context.Background(), clientFor(first, second),
		mirrorsOf(first, second), MirrorStagger)
	if err != nil {
		t.Fatalf("RaceManifest() error = %v", err)
	}
	if fetched.Mirror.Name != "first" {
		t.Fatalf("winner = %q, want the preferred mirror", fetched.Mirror.Name)
	}
	if hits := second.hits.Load(); hits != 0 {
		t.Errorf("the second mirror was asked %d times, want it never started", hits)
	}
	if len(fetched.Order) != 2 || fetched.Order[0].Name != "first" || fetched.Order[1].Name != "second" {
		t.Errorf("order = %v, want the winner first and the rest behind it", fetched.Order)
	}
}

func TestRaceFallsThroughToAMirrorThatWorks(t *testing.T) {
	broken := newFakeMirror(t, "broken", 0, http.StatusInternalServerError, `{}`)
	good := newFakeMirror(t, "good", 0, http.StatusOK, manifestJSON("1.5.0"))

	// No stagger: what is under test is the fall-through, not the timing.
	fetched, err := RaceManifest(context.Background(), clientFor(broken, good),
		mirrorsOf(broken, good), 0)
	if err != nil {
		t.Fatalf("RaceManifest() error = %v", err)
	}
	if fetched.Mirror.Name != "good" {
		t.Fatalf("winner = %q, want the mirror that answered", fetched.Mirror.Name)
	}
	if fetched.Manifest.Version != "1.5.0" {
		t.Errorf("version = %q", fetched.Manifest.Version)
	}
}

// The failure this whole design exists for: a mirror that accepts the
// connection and then says nothing must not hold up the check.
func TestRaceDoesNotWaitForAMirrorThatNeverAnswers(t *testing.T) {
	hung := newFakeMirror(t, "hung", time.Minute, http.StatusOK, "")
	good := newFakeMirror(t, "good", 0, http.StatusOK, manifestJSON("1.5.0"))

	start := time.Now()
	fetched, err := RaceManifest(context.Background(), clientFor(hung, good),
		mirrorsOf(hung, good), 50*time.Millisecond)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("RaceManifest() error = %v", err)
	}
	if fetched.Mirror.Name != "good" {
		t.Fatalf("winner = %q, want the mirror that answered", fetched.Mirror.Name)
	}
	if elapsed > 5*time.Second {
		t.Errorf("took %v, want the race decided by the second mirror rather than the first", elapsed)
	}
}

func TestRaceNamesEveryMirrorWhenNoneAnswer(t *testing.T) {
	first := newFakeMirror(t, "first", 0, http.StatusInternalServerError, `{}`)
	second := newFakeMirror(t, "second", 0, http.StatusNotFound, `{}`)

	_, err := RaceManifest(context.Background(), clientFor(first, second),
		mirrorsOf(first, second), 0)
	if err == nil {
		t.Fatal("RaceManifest() should fail when no mirror answers")
	}
	for _, want := range []string{"first", "second", "500", "404"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %v, want it to mention %q", err, want)
		}
	}
	if strings.Contains(err.Error(), "\n") {
		t.Errorf("error = %q, want one line: it is shown to the user as one", err)
	}
}

// A manifest this build cannot read will read no better anywhere else, so the
// race stops rather than spending the other mirrors on the same answer.
func TestRaceStopsAtAManifestFromALaterBuild(t *testing.T) {
	future := newFakeMirror(t, "future", 0, http.StatusOK, `{"schema":99,"version":"9.0.0"}`)
	other := newFakeMirror(t, "other", 0, http.StatusOK, manifestJSON("1.5.0"))

	_, err := RaceManifest(context.Background(), clientFor(future, other),
		mirrorsOf(future, other), MirrorStagger)
	if !errors.Is(err, ErrSchemaTooNew) {
		t.Fatalf("RaceManifest() error = %v, want ErrSchemaTooNew", err)
	}
	if hits := other.hits.Load(); hits != 0 {
		t.Errorf("the second mirror was asked %d times, want the race abandoned", hits)
	}
}

func TestRaceRefusesWithNoUsableMirror(t *testing.T) {
	plain := Mirror{Name: "plain", ManifestURL: "http://example.invalid/l.json", AssetBase: "http://example.invalid"}
	_, err := RaceManifest(context.Background(), http.DefaultClient, []Mirror{plain}, 0)
	if err == nil || !strings.Contains(err.Error(), "no usable mirror") {
		t.Fatalf("RaceManifest() error = %v", err)
	}
}

// A manifest can add a mirror but never take one away or redefine one, which
// bounds what a mirror that starts lying is able to do to the list.
func TestMergeMirrorsCannotRemoveOrRedefineACompiledInMirror(t *testing.T) {
	hostile := []Mirror{
		{Name: "r2", ManifestURL: "https://elsewhere.example/l.json", AssetBase: "https://elsewhere.example"},
		{Name: "cn", ManifestURL: "https://cdn.example/l.json", AssetBase: "https://cdn.example"},
	}
	merged := MergeMirrors(BootstrapMirrors(), hostile)

	r2, found := findMirror(merged, "r2")
	if !found {
		t.Fatal("the compiled-in r2 mirror was dropped")
	}
	if r2.AssetBase != "https://dl.amigoer.com" {
		t.Errorf("r2 base = %q, want the compiled-in one to win", r2.AssetBase)
	}
	if _, found := findMirror(merged, "github"); !found {
		t.Error("the compiled-in github mirror was dropped")
	}
	if merged[len(merged)-1].Name != "cn" {
		t.Errorf("merged = %v, want a learned mirror added behind the known ones", merged)
	}
}

func TestMergeMirrorsRejectsAnythingNotOverHTTPS(t *testing.T) {
	learned := []Mirror{
		{Name: "plain", ManifestURL: "http://cdn.example/l.json", AssetBase: "http://cdn.example"},
		{Name: "nameless", ManifestURL: "https://cdn.example/l.json", AssetBase: "https://cdn.example"},
	}
	learned[1].Name = ""
	merged := MergeMirrors(BootstrapMirrors(), learned)
	if len(merged) != 2 {
		t.Fatalf("merged = %v, want only the compiled-in mirrors", merged)
	}
}

func TestAssetURLJoinsWithExactlyOneSlash(t *testing.T) {
	cases := []struct{ base, path, want string }{
		{"https://dl.example", "v1.0.0/a.dmg", "https://dl.example/v1.0.0/a.dmg"},
		{"https://dl.example/", "v1.0.0/a.dmg", "https://dl.example/v1.0.0/a.dmg"},
		{"https://dl.example", "/v1.0.0/a.dmg", "https://dl.example/v1.0.0/a.dmg"},
		{"https://dl.example/", "/v1.0.0/a.dmg", "https://dl.example/v1.0.0/a.dmg"},
	}
	for _, testCase := range cases {
		got := Mirror{AssetBase: testCase.base}.AssetURL(testCase.path)
		if got != testCase.want {
			t.Errorf("AssetURL(%q, %q) = %q, want %q", testCase.base, testCase.path, got, testCase.want)
		}
	}
}

// The manifest's own mirror list is how a mirror added later reaches a build
// that shipped before it existed, and the remembered winner is what keeps a
// routine check down to one request.
func TestAWinningMirrorIsLearnedThenPreferredUntilItGoesStale(t *testing.T) {
	cn := Mirror{Name: "cn", ManifestURL: "https://cdn.example/l.json", AssetBase: "https://cdn.example"}
	var handed [][]Mirror
	moment := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)

	manager := New(Options{
		Version:   "1.0.0",
		Directory: t.TempDir(),
		Policy:    func() Policy { return PolicyNotify },
		Location:  &testLocation,
		Now:       func() time.Time { return moment },
		Check: func(_ context.Context, _ string, _ *http.Client, mirrors []Mirror) (Result, error) {
			handed = append(handed, mirrors)
			return Result{
				Status:         StatusCurrent,
				CurrentVersion: "1.0.0",
				LatestVersion:  "1.0.0",
				Manifest:       Manifest{Mirrors: []Mirror{cn}},
				Mirror:         cn,
				Order:          []Mirror{cn},
			}, nil
		},
	})
	t.Cleanup(manager.Close)

	// Nothing is known yet, so the first check races everything compiled in.
	if _, err := manager.Check(context.Background(), true); err != nil {
		t.Fatalf("first Check() error = %v", err)
	}
	if len(handed[0]) != 2 {
		t.Fatalf("first check was handed %v, want the compiled-in mirrors", handed[0])
	}

	// cn won and was named by the manifest, so the next check goes straight
	// to it and to nothing else.
	if _, err := manager.Check(context.Background(), true); err != nil {
		t.Fatalf("second Check() error = %v", err)
	}
	if len(handed[1]) != 1 || handed[1][0].Name != "cn" {
		t.Fatalf("second check was handed %v, want only the remembered winner", handed[1])
	}

	// Past the TTL it is measured again rather than trusted forever, which is
	// also what lets a mirror added since then get a turn.
	moment = moment.Add(MirrorPreferenceTTL + time.Hour)
	if _, err := manager.Check(context.Background(), true); err != nil {
		t.Fatalf("third Check() error = %v", err)
	}
	if len(handed[2]) != 3 {
		t.Fatalf("third check was handed %v, want the learned mirror racing the rest", handed[2])
	}
}

func TestAPreferredMirrorThatStopsAnsweringFallsBackToTheRace(t *testing.T) {
	cn := Mirror{Name: "cn", ManifestURL: "https://cdn.example/l.json", AssetBase: "https://cdn.example"}
	var handed [][]Mirror

	manager := New(Options{
		Version:   "1.0.0",
		Directory: t.TempDir(),
		Policy:    func() Policy { return PolicyNotify },
		Location:  &testLocation,
		Check: func(_ context.Context, _ string, _ *http.Client, mirrors []Mirror) (Result, error) {
			handed = append(handed, mirrors)
			// Whatever won last time is now unreachable.
			if len(mirrors) == 1 {
				return Result{}, errors.New("blocked")
			}
			return Result{
				Status:         StatusCurrent,
				CurrentVersion: "1.0.0",
				LatestVersion:  "1.0.0",
				Manifest:       Manifest{Mirrors: []Mirror{cn}},
				Mirror:         cn,
				Order:          []Mirror{cn},
			}, nil
		},
	})
	t.Cleanup(manager.Close)

	if _, err := manager.Check(context.Background(), true); err != nil {
		t.Fatalf("first Check() error = %v", err)
	}
	if _, err := manager.Check(context.Background(), true); err != nil {
		t.Fatalf("second Check() error = %v, want the race to have rescued it", err)
	}
	if len(handed) != 3 {
		t.Fatalf("checks handed %v, want the preferred attempt then a full race", handed)
	}
	if len(handed[1]) != 1 || len(handed[2]) != 3 {
		t.Fatalf("second check tried %v then %v, want one mirror then all of them", handed[1], handed[2])
	}
}

// packageServer stands in for a mirror's asset host: it serves body for any
// path, or refuses everything.
func packageServer(t *testing.T, name string, body []byte, status int) Mirror {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return Mirror{Name: name, ManifestURL: server.URL + "/latest.json", AssetBase: server.URL}
}

// harnessFor builds a manager whose check answers with a fixed result, so a
// test can choose the mirrors a download is handed.
func harnessFor(t *testing.T, published *release, result Result) *harness {
	t.Helper()
	watch := newWatcher()
	commander := &fakeCommander{}
	directory := t.TempDir()
	manager := New(Options{
		Version:   "1.0.0",
		Directory: directory,
		Policy:    func() Policy { return PolicyNotify },
		Emit:      watch.emit,
		Client:    published.server.Client(),
		Commander: commander,
		Location:  &testLocation,
		Check: func(context.Context, string, *http.Client, []Mirror) (Result, error) {
			return result, nil
		},
	})
	t.Cleanup(manager.Close)
	return &harness{manager: manager, watch: watch, commander: commander, directory: directory}
}

// A mirror that cannot serve the package costs one attempt, not the update.
func TestDownloadFallsOverToTheNextMirror(t *testing.T) {
	published := newRelease(t, release{})
	broken := packageServer(t, "broken", nil, http.StatusInternalServerError)

	result := published.result()
	result.Mirror = broken
	result.Order = []Mirror{broken, published.mirror()}

	h := harnessFor(t, published, result)
	if err := h.manager.Download(context.Background(), result); err != nil {
		t.Fatalf("Download() error = %v, want the second mirror to have served it", err)
	}
	state := h.manager.State()
	if state.Phase != PhaseReady {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseReady)
	}
	if state.Mirror != "test" {
		t.Errorf("mirror = %q, want the state to name the one that worked", state.Mirror)
	}
}

// Falling over is only safe because the digest travels in the manifest: a
// mirror serving something else has to be caught and then left behind.
func TestAMirrorServingTheWrongBytesIsRejectedAndPassedOver(t *testing.T) {
	published := newRelease(t, release{})
	lying := packageServer(t, "lying", []byte("something else entirely"), http.StatusOK)

	result := published.result()
	result.Mirror = lying
	result.Order = []Mirror{lying, published.mirror()}

	h := harnessFor(t, published, result)
	if err := h.manager.Download(context.Background(), result); err != nil {
		t.Fatalf("Download() error = %v, want the honest mirror to have finished it", err)
	}
	if h.manager.State().Mirror != "test" {
		t.Errorf("mirror = %q, want the lying one passed over", h.manager.State().Mirror)
	}
}

// With every mirror lying there is nothing to fall back to, and the reason has
// to survive the fall-through so a caller can still tell what went wrong.
func TestEveryMirrorLyingStillReportsAChecksumMismatch(t *testing.T) {
	published := newRelease(t, release{})
	first := packageServer(t, "first", []byte("wrong"), http.StatusOK)
	second := packageServer(t, "second", []byte("also wrong"), http.StatusOK)

	result := published.result()
	result.Mirror = first
	result.Order = []Mirror{first, second}

	h := harnessFor(t, published, result)
	err := h.manager.Download(context.Background(), result)
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("Download() error = %v, want ErrChecksumMismatch to survive the fall-through", err)
	}
	if !strings.Contains(err.Error(), "first") || !strings.Contains(err.Error(), "second") {
		t.Errorf("error = %v, want it to name both mirrors", err)
	}
}

// The app, the manifest every release carries and the website's download links
// all name these hosts, from three separate copies of the list. A release that
// points somewhere the app does not look is not a recoverable mistake, so the
// copies are pinned to each other rather than trusted to be kept in step.
func TestBootstrapMirrorsMatchTheReleaseTooling(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "scripts", "mirrors.json"))
	if err != nil {
		t.Fatalf("reading the shared mirror list: %v", err)
	}
	var shared []Mirror
	if err := json.Unmarshal(content, &shared); err != nil {
		t.Fatalf("scripts/mirrors.json is not readable: %v", err)
	}
	compiled := BootstrapMirrors()
	if len(shared) != len(compiled) {
		t.Fatalf("scripts/mirrors.json has %d mirrors, the build has %d", len(shared), len(compiled))
	}
	for index, want := range shared {
		if compiled[index] != want {
			t.Errorf("mirror %d is %+v in the build and %+v in scripts/mirrors.json", index, compiled[index], want)
		}
	}
}
