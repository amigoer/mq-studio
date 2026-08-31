package update

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// release stands in for a published GitHub release: the package this platform
// would install, and the checksum list it is verified against.
type release struct {
	version string
	payload []byte
	server  *httptest.Server
	// corrupt serves content that does not match the published digest.
	corrupt bool
	// omitSums leaves SHA256SUMS.txt off the release.
	omitSums bool
	// unlisted publishes the checksum file without this platform's package.
	unlisted bool
}

const testTarget = "mq-studio-9.9.9-mac-arm64.dmg"

var testLocation = Location{
	Kind:   KindAppBundle,
	Target: Target{OS: "mac", Arch: "arm64", Ext: "dmg"},
	Root:   "/Applications/MQ Studio.app",
}

func newRelease(t *testing.T, options release) *release {
	t.Helper()
	if options.version == "" {
		options.version = "9.9.9"
	}
	if options.payload == nil {
		options.payload = []byte(strings.Repeat("package-", 40_000))
	}
	served := options.payload
	if options.corrupt {
		served = []byte("something else entirely")
	}
	name := Target{OS: "mac", Arch: "arm64", Ext: "dmg"}.PackageName(options.version)
	listed := name
	if options.unlisted {
		listed = "mq-studio-" + options.version + "-linux-amd64.AppImage"
	}
	sums := digestOf(options.payload) + "  " + listed + "\n"

	options.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/" + checksumAssetName:
			w.Header().Set("Content-Length", strconv.Itoa(len(sums)))
			_, _ = w.Write([]byte(sums))
		case "/" + name:
			w.Header().Set("Content-Length", strconv.Itoa(len(served)))
			_, _ = w.Write(served)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(options.server.Close)
	return &options
}

func (r *release) result() Result {
	assets := []Asset{{
		Name: Target{OS: "mac", Arch: "arm64", Ext: "dmg"}.PackageName(r.version),
		URL:  r.server.URL + "/" + Target{OS: "mac", Arch: "arm64", Ext: "dmg"}.PackageName(r.version),
		Size: int64(len(r.payload)),
	}}
	if !r.omitSums {
		assets = append(assets, Asset{Name: checksumAssetName, URL: r.server.URL + "/" + checksumAssetName})
	}
	return Result{
		Status:         StatusAvailable,
		CurrentVersion: "1.0.0",
		LatestVersion:  r.version,
		Notes:          "## What changed\n- everything",
		PublishedAt:    "2026-08-30T00:00:00Z",
		ReleaseURL:     "https://github.com/amigoer/mq-studio/releases/tag/v" + r.version,
		Assets:         assets,
	}
}

// watcher collects the states a manager emits and lets a test wait for one.
type watcher struct {
	mu     sync.Mutex
	states []State
	wake   chan struct{}
}

func newWatcher() *watcher { return &watcher{wake: make(chan struct{}, 64)} }

func (w *watcher) emit(state State) {
	w.mu.Lock()
	w.states = append(w.states, state)
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// await blocks until the manager reports one of the given phases.
func (w *watcher) await(t *testing.T, manager *Manager, phases ...Phase) State {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		state := manager.State()
		for _, phase := range phases {
			if state.Phase == phase {
				return state
			}
		}
		select {
		case <-w.wake:
		case <-deadline:
			t.Fatalf("timed out in phase %q waiting for %v (error: %q)", state.Phase, phases, state.Error)
		}
	}
}

type harness struct {
	manager   *Manager
	watch     *watcher
	commander *fakeCommander
	directory string
}

func newManager(t *testing.T, policy Policy, options release) *harness {
	t.Helper()
	published := newRelease(t, options)
	watch := newWatcher()
	commander := &fakeCommander{}
	directory := t.TempDir()
	manager := New(Options{
		Version:   "1.0.0",
		Directory: directory,
		Policy:    func() Policy { return policy },
		Emit:      watch.emit,
		Client:    published.server.Client(),
		Commander: commander,
		Location:  &testLocation,
		Check: func(string, *http.Client) (Result, error) {
			return published.result(), nil
		},
	})
	t.Cleanup(manager.Close)
	return &harness{manager: manager, watch: watch, commander: commander, directory: directory}
}

func TestNotifyStopsAtAvailableAndDownloadsNothing(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})

	if _, err := h.manager.Check(context.Background(), true); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	state := h.manager.State()
	if state.Phase != PhaseAvailable {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseAvailable)
	}
	if state.LatestVersion != "9.9.9" {
		t.Errorf("latest = %q", state.LatestVersion)
	}
	if state.Notes == "" || state.ReleaseURL == "" {
		t.Error("the release notes and link should reach the renderer")
	}
	// Give an accidental background download time to appear.
	time.Sleep(150 * time.Millisecond)
	if h.manager.State().Phase != PhaseAvailable {
		t.Errorf("notify downloaded on its own: %q", h.manager.State().Phase)
	}
	if _, err := os.Stat(filepath.Join(h.directory, testTarget)); !os.IsNotExist(err) {
		t.Error("notify should leave nothing on disk")
	}
}

func TestDownloadPolicyFetchesAndVerifiesWithoutBeingAsked(t *testing.T) {
	h := newManager(t, PolicyDownload, release{})

	if _, err := h.manager.Check(context.Background(), false); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	state := h.watch.await(t, h.manager, PhaseReady, PhaseError)
	if state.Phase != PhaseReady {
		t.Fatalf("phase = %q, error = %q", state.Phase, state.Error)
	}
	if _, err := os.Stat(filepath.Join(h.directory, testTarget)); err != nil {
		t.Fatalf("the verified package is not on disk: %v", err)
	}
	// The download is remembered, so a restart does not fetch it again.
	if h.manager.memory.ReadyVersion != "9.9.9" {
		t.Errorf("remembered %q", h.manager.memory.ReadyVersion)
	}
}

func TestDownloadPolicySkipsAReleaseTheUserDeclined(t *testing.T) {
	h := newManager(t, PolicyDownload, release{})
	h.manager.Skip("9.9.9")

	if _, err := h.manager.Check(context.Background(), false); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	time.Sleep(150 * time.Millisecond)
	if phase := h.manager.State().Phase; phase != PhaseAvailable {
		t.Fatalf("phase = %q, want a skipped release to stop at %q", phase, PhaseAvailable)
	}
	// What the renderer keys on: the release it would announce is the one the
	// user has already declined.
	if state := h.manager.State(); state.Skipped != state.LatestVersion {
		t.Errorf("skipped = %q, latest = %q, want a skipped release to match", state.Skipped, state.LatestVersion)
	}
}

func TestAutoPolicyInstallsOnQuitAndNotBefore(t *testing.T) {
	h := newManager(t, PolicyAuto, release{})
	// Apply needs somewhere real to swap, so the location points at a bundle
	// this test owns.
	applications := t.TempDir()
	app := filepath.Join(applications, "MQ Studio.app")
	bundle(t, app, "old")
	h.manager.location = Location{Kind: KindAppBundle, Target: testLocation.Target, Root: app}
	h.commander.onRun = dmgCommander(t, "new").onRun

	if _, err := h.manager.Check(context.Background(), false); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	h.watch.await(t, h.manager, PhaseReady, PhaseError)

	// Nothing is applied while the app is up.
	if got := bundleMarker(t, app); got != "old" {
		t.Fatalf("auto installed mid-session: bundle contains %q", got)
	}

	installed, err := h.manager.InstallOnQuit(context.Background())
	if err != nil {
		t.Fatalf("InstallOnQuit() error = %v", err)
	}
	if !installed {
		t.Fatal("InstallOnQuit() reported nothing to do")
	}
	if got := bundleMarker(t, app); got != "new" {
		t.Errorf("bundle contains %q after the quit install", got)
	}
	if _, err := os.Stat(filepath.Join(h.directory, testTarget)); !os.IsNotExist(err) {
		t.Error("the package should be cleaned up once it is installed")
	}
}

func TestInstallOnQuitDoesNothingBelowTheAutoPolicy(t *testing.T) {
	h := newManager(t, PolicyDownload, release{})
	if _, err := h.manager.Check(context.Background(), false); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	h.watch.await(t, h.manager, PhaseReady, PhaseError)

	installed, err := h.manager.InstallOnQuit(context.Background())
	if err != nil {
		t.Fatalf("InstallOnQuit() error = %v", err)
	}
	if installed {
		t.Fatal("only the auto policy may install without being asked")
	}
	if h.manager.State().Phase != PhaseReady {
		t.Errorf("phase = %q, want the package left ready", h.manager.State().Phase)
	}
}

func TestInstallAppliesAndRelaunches(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})
	applications := t.TempDir()
	app := filepath.Join(applications, "MQ Studio.app")
	bundle(t, app, "old")
	h.manager.location = Location{Kind: KindAppBundle, Target: testLocation.Target, Root: app}
	h.commander.onRun = dmgCommander(t, "new").onRun

	if err := h.manager.Download(context.Background(), Result{}); err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	h.watch.await(t, h.manager, PhaseReady, PhaseError)

	if err := h.manager.Install(context.Background()); err != nil {
		t.Fatalf("Install() error = %v", err)
	}
	if got := bundleMarker(t, app); got != "new" {
		t.Errorf("bundle contains %q", got)
	}
	if len(h.commander.started) != 1 || !strings.Contains(h.commander.started[0], "open ") {
		t.Errorf("started %v, want a relaunch", h.commander.started)
	}
	if phase := h.manager.State().Phase; phase != PhaseIdle {
		t.Errorf("phase = %q, want the update to be done with", phase)
	}
}

func TestInstallRefusesWithNothingDownloaded(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})
	if err := h.manager.Install(context.Background()); err == nil {
		t.Fatal("Install() should refuse with no package ready")
	}
}

func TestDownloadRejectsAPackageThatFailsVerification(t *testing.T) {
	h := newManager(t, PolicyDownload, release{corrupt: true})

	err := h.manager.Download(context.Background(), Result{})
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("Download() error = %v, want ErrChecksumMismatch", err)
	}
	state := h.manager.State()
	if state.Phase != PhaseError || state.FailedStep != StepDownload {
		t.Fatalf("phase = %q, step = %q", state.Phase, state.FailedStep)
	}
	if _, err := os.Stat(filepath.Join(h.directory, testTarget)); !os.IsNotExist(err) {
		t.Error("a package that fails verification must not be kept")
	}
}

func TestDownloadRefusesAReleaseWithNoChecksums(t *testing.T) {
	h := newManager(t, PolicyDownload, release{omitSums: true})
	err := h.manager.Download(context.Background(), Result{})
	if err == nil || !strings.Contains(err.Error(), checksumAssetName) {
		t.Fatalf("Download() error = %v, want it to name the missing checksum list", err)
	}
}

func TestDownloadRefusesAPackageThatIsNotInTheChecksumList(t *testing.T) {
	h := newManager(t, PolicyDownload, release{unlisted: true})
	err := h.manager.Download(context.Background(), Result{})
	if err == nil || !strings.Contains(err.Error(), "not listed") {
		t.Fatalf("Download() error = %v, want it to refuse an unlisted package", err)
	}
}

func TestDownloadRefusesAnInstallItCannotReplace(t *testing.T) {
	h := newManager(t, PolicyDownload, release{})
	h.manager.location = Location{Kind: KindManaged, Blocker: BlockerPackageManager}

	err := h.manager.Download(context.Background(), Result{})
	if !errors.Is(err, ErrNotInstallable) {
		t.Fatalf("Download() error = %v, want ErrNotInstallable", err)
	}
}

func TestCancelLeavesTheReleaseAvailableRatherThanFailed(t *testing.T) {
	h := newManager(t, PolicyNotify, release{payload: []byte(strings.Repeat("x", 8<<20))})

	done := make(chan error, 1)
	go func() { done <- h.manager.Download(context.Background(), Result{}) }()
	h.watch.await(t, h.manager, PhaseDownloading)
	h.manager.Cancel()

	if err := <-done; err != nil {
		t.Fatalf("a cancelled download is not a failure: %v", err)
	}
	state := h.manager.State()
	if state.Phase != PhaseAvailable {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseAvailable)
	}
	if state.Error != "" {
		t.Errorf("error = %q, want none", state.Error)
	}
}

func TestCheckClearsAReleaseThatIsNoLongerNewer(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})
	if _, err := h.manager.Check(context.Background(), true); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if h.manager.State().LatestVersion == "" {
		t.Fatal("the first check should find a release")
	}

	// The second check answers "you are up to date", as it would after an
	// install: the marker in the UI has to clear itself.
	h.manager.check = func(string, *http.Client) (Result, error) {
		return Result{Status: StatusCurrent, CurrentVersion: "1.0.0", LatestVersion: "1.0.0"}, nil
	}
	state, err := h.manager.Check(context.Background(), true)
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if state.Phase != PhaseIdle || state.LatestVersion != "" {
		t.Fatalf("phase = %q, latest = %q", state.Phase, state.LatestVersion)
	}
}

func TestCheckRecordsWhenItLastRanEvenWhenItFails(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})
	h.manager.check = func(string, *http.Client) (Result, error) {
		return Result{}, errors.New("offline")
	}
	moment := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)
	h.manager.now = func() time.Time { return moment }

	if _, err := h.manager.Check(context.Background(), true); err == nil {
		t.Fatal("Check() should report the failure")
	}
	state := h.manager.State()
	if state.Phase != PhaseError || state.FailedStep != StepCheck {
		t.Fatalf("phase = %q, step = %q", state.Phase, state.FailedStep)
	}
	if state.CheckedAt != moment.Format(time.RFC3339) {
		t.Errorf("checkedAt = %q, want a failed check to still count against the interval", state.CheckedAt)
	}
}

func TestDevelopmentBuildsHaveNothingToCompareAgainst(t *testing.T) {
	manager := New(Options{
		Version:   "dev",
		Directory: t.TempDir(),
		Policy:    func() Policy { return PolicyAuto },
		Location:  &testLocation,
		Check: func(string, *http.Client) (Result, error) {
			t.Error("a development build must not query GitHub")
			return Result{}, nil
		},
	})
	t.Cleanup(manager.Close)

	if _, err := manager.Check(context.Background(), true); err == nil {
		t.Fatal("Check() should refuse a development build")
	}
	// Start returns without scheduling anything.
	manager.Start(context.Background())
	time.Sleep(50 * time.Millisecond)
}

func TestAFinishedDownloadSurvivesARestart(t *testing.T) {
	directory := t.TempDir()
	packagePath := filepath.Join(directory, testTarget)
	if err := os.WriteFile(packagePath, []byte("package"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, memoryFile),
		[]byte(`{"readyVersion":"9.9.9","readyPath":`+strconv.Quote(packagePath)+`,"skipped":"8.8.8"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	manager := New(Options{
		Version: "1.0.0", Directory: directory,
		Policy: func() Policy { return PolicyNotify }, Location: &testLocation,
	})
	t.Cleanup(manager.Close)

	state := manager.State()
	if state.Phase != PhaseReady {
		t.Fatalf("phase = %q, want the finished download to be picked back up", state.Phase)
	}
	if state.LatestVersion != "9.9.9" {
		t.Errorf("latest = %q", state.LatestVersion)
	}
	if state.Skipped != "8.8.8" {
		t.Errorf("skipped = %q, want the skip list to survive too", state.Skipped)
	}
}

func TestAPackageThisBuildHasOvertakenIsThrownAway(t *testing.T) {
	directory := t.TempDir()
	packagePath := filepath.Join(directory, "mq-studio-1.0.0-mac-arm64.dmg")
	if err := os.WriteFile(packagePath, []byte("package"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, memoryFile),
		[]byte(`{"readyVersion":"1.0.0","readyPath":`+strconv.Quote(packagePath)+`}`), 0o600); err != nil {
		t.Fatal(err)
	}

	// 1.0.0 is what is now running, so the package it came from is spent.
	manager := New(Options{
		Version: "1.0.0", Directory: directory,
		Policy: func() Policy { return PolicyNotify }, Location: &testLocation,
	})
	t.Cleanup(manager.Close)

	if phase := manager.State().Phase; phase != PhaseIdle {
		t.Fatalf("phase = %q, want %q", phase, PhaseIdle)
	}
	if _, err := os.Stat(packagePath); !os.IsNotExist(err) {
		t.Error("the installed package should have been cleaned up")
	}
}

func TestValidPolicyNamesTheLadder(t *testing.T) {
	for _, value := range []string{"off", "notify", "download", "auto"} {
		if !ValidPolicy(value) {
			t.Errorf("ValidPolicy(%q) = false", value)
		}
	}
	for _, value := range []string{"", "on", "silent", "AUTO"} {
		if ValidPolicy(value) {
			t.Errorf("ValidPolicy(%q) = true", value)
		}
	}
}

// The renderer tells "you are up to date" from "you are ahead of the latest
// release" by the outcome alone, since neither is a phase.
func TestCheckReportsWhatItConcluded(t *testing.T) {
	cases := []struct {
		status Status
		phase  Phase
	}{
		{StatusCurrent, PhaseIdle},
		{StatusAhead, PhaseIdle},
	}
	for _, testCase := range cases {
		h := newManager(t, PolicyNotify, release{})
		h.manager.check = func(string, *http.Client) (Result, error) {
			return Result{Status: testCase.status, CurrentVersion: "1.0.0", LatestVersion: "0.9.0"}, nil
		}
		state, err := h.manager.Check(context.Background(), true)
		if err != nil {
			t.Fatalf("Check() error = %v", err)
		}
		if state.Outcome != testCase.status {
			t.Errorf("outcome = %q, want %q", state.Outcome, testCase.status)
		}
		if state.Phase != testCase.phase {
			t.Errorf("phase = %q, want %q", state.Phase, testCase.phase)
		}
		if state.LatestVersion != "" {
			t.Errorf("latest = %q, want nothing pending", state.LatestVersion)
		}
	}
}

// A development build has to say what it is. Reporting "you are up to date"
// for a version that was never released is worse than saying nothing.
func TestDevelopmentBuildsAreMarkedAsSuch(t *testing.T) {
	development := New(Options{Version: "dev", Directory: t.TempDir(), Location: &testLocation})
	t.Cleanup(development.Close)
	if !development.State().Development {
		t.Error("a build with no release version should be marked as development")
	}

	released := New(Options{Version: "1.0.0", Directory: t.TempDir(), Location: &testLocation})
	t.Cleanup(released.Close)
	if released.State().Development {
		t.Error("a released build should not be marked as development")
	}
}

// The download directory holds the updater's own memory as well as the
// packages, and sweeping the stale ones away must not take it with them.
func TestDownloadingClearsOldPackagesButKeepsTheMemory(t *testing.T) {
	h := newManager(t, PolicyNotify, release{})
	h.manager.Skip("8.8.8")
	stale := filepath.Join(h.directory, "mq-studio-9.9.8-mac-arm64.dmg")
	if err := os.WriteFile(stale, []byte("an older download"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := h.manager.Download(context.Background(), Result{}); err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	h.watch.await(t, h.manager, PhaseReady, PhaseError)

	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("the superseded package should have been swept away")
	}
	if _, err := os.Stat(filepath.Join(h.directory, memoryFile)); err != nil {
		t.Fatalf("the updater's memory was swept away with the packages: %v", err)
	}

	// And it still says what it said: a restart must not re-offer the skip.
	restarted := New(Options{
		Version: "1.0.0", Directory: h.directory,
		Policy: func() Policy { return PolicyNotify }, Location: &testLocation,
	})
	t.Cleanup(restarted.Close)
	if got := restarted.State().Skipped; got != "8.8.8" {
		t.Errorf("skipped = %q after a restart, want it remembered", got)
	}
}
