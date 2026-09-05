package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

/*
 * The update lifecycle: when to look, what to fetch, and how far the app may
 * go on its own.
 *
 * The schedule lives here rather than in the renderer because the window is not
 * always there to run it -- closing to the tray leaves the process up for days.
 * The renderer reads State and subscribes to Event; it decides nothing.
 */

// Event is emitted whenever State changes. Keep in step with the name the
// renderer subscribes to in frontend/src/api/updates.ts.
const Event = "update:state"

// Policy is how much the app may do without being asked.
type Policy string

const (
	// PolicyOff never checks. A manual check still works.
	PolicyOff Policy = "off"
	// PolicyNotify checks and reports; downloading is the user's call.
	PolicyNotify Policy = "notify"
	// PolicyDownload fetches and verifies in the background, then waits to be
	// told to install.
	PolicyDownload Policy = "download"
	// PolicyAuto also installs, at quit, so an update never interrupts a
	// session it was not asked for.
	PolicyAuto Policy = "auto"
)

// ValidPolicy reports whether value names a policy.
func ValidPolicy(value string) bool {
	switch Policy(value) {
	case PolicyOff, PolicyNotify, PolicyDownload, PolicyAuto:
		return true
	}
	return false
}

// downloads reports whether a policy fetches without being asked.
func (p Policy) downloads() bool { return p == PolicyDownload || p == PolicyAuto }

// Phase is what the updater is doing.
type Phase string

const (
	// PhaseIdle means nothing newer is known of.
	PhaseIdle Phase = "idle"
	// PhaseChecking means a check is in flight.
	PhaseChecking Phase = "checking"
	// PhaseAvailable means a newer release exists and nothing is downloaded.
	PhaseAvailable Phase = "available"
	// PhaseDownloading means the package is being fetched.
	PhaseDownloading Phase = "downloading"
	// PhaseReady means a verified package is waiting to be installed.
	PhaseReady Phase = "ready"
	// PhaseInstalling means the package is being applied.
	PhaseInstalling Phase = "installing"
	// PhaseError means the last operation failed; Error says which and why.
	PhaseError Phase = "error"
)

// FailedStep names which part of the last failure, so the renderer can offer
// the right way out -- retry a download, open the releases page for the rest.
type FailedStep string

const (
	StepNone     FailedStep = ""
	StepCheck    FailedStep = "check"
	StepDownload FailedStep = "download"
	StepInstall  FailedStep = "install"
)

// State is everything the renderer draws. It is a value: callers get a copy.
type State struct {
	Phase  Phase  `json:"phase"`
	Policy Policy `json:"policy"`
	// The build that is running.
	CurrentVersion string `json:"currentVersion"`
	// True for a build with no release to compare against -- `wails3 dev`, or
	// anything else that did not get a version at link time. The updater is
	// inert, and the panel says so rather than claiming to be up to date.
	Development bool `json:"development"`
	// The newest release, or "" when none is known or it is not newer.
	LatestVersion string `json:"latestVersion"`
	Notes         string `json:"notes"`
	// RFC3339, or "" when unknown.
	PublishedAt string `json:"publishedAt"`
	ReleaseURL  string `json:"releaseURL"`
	// Bytes fetched and expected. Total is -1 when the server sent no length.
	Downloaded int64 `json:"downloaded"`
	Total      int64 `json:"total"`
	// Mirror is the one currently being read from, "" before any has been
	// chosen. It is in the state so a failure can be diagnosed after the fact:
	// which route a user took is otherwise invisible to everyone.
	Mirror string `json:"mirror"`
	// What the last check concluded. Empty until one has run: it is a fact
	// about a check, not a phase, which is why it sits beside Phase rather
	// than in it.
	Outcome Status `json:"outcome"`
	// RFC3339 of the last completed check, successful or not.
	CheckedAt string `json:"checkedAt"`
	// A release the user asked not to be told about again.
	Skipped string `json:"skipped"`
	// Where this build is installed and whether it can replace itself.
	Location Location `json:"location"`
	// Human-readable failure for PhaseError, and the step it happened in.
	Error      string     `json:"error"`
	FailedStep FailedStep `json:"failedStep"`
}

// memory is the part of State that has to survive a restart: what was already
// checked and skipped, and a package that finished downloading but was never
// installed.
type memory struct {
	CheckedAt    string `json:"checkedAt"`
	Skipped      string `json:"skipped"`
	ReadyVersion string `json:"readyVersion"`
	ReadyPath    string `json:"readyPath"`
	// PreferredMirror won the last race and MirrorMeasured is when. Reused on
	// its own for MirrorPreferenceTTL, which is what keeps a routine check to a
	// single request.
	PreferredMirror string `json:"preferredMirror,omitempty"`
	MirrorMeasured  string `json:"mirrorMeasured,omitempty"`
	// LearnedMirrors are the ones a manifest named. Kept so a mirror added to a
	// later release reaches builds that shipped before it existed.
	LearnedMirrors []Mirror `json:"learnedMirrors,omitempty"`
}

// Options configures a Manager. Only Version and Directory are required; the
// rest have working defaults and exist so the tests can stand in for the world.
type Options struct {
	// Version is the running build, as injected at link time.
	Version string
	// Directory is where downloaded packages are kept.
	Directory string
	// Policy reads the current setting. Required.
	Policy func() Policy
	// Emit publishes a state change to the renderer. Optional.
	Emit func(State)
	// Client, Commander, Location, Now and Delay are seams for the tests.
	Client    *http.Client
	Commander Commander
	Location  *Location
	Now       func() time.Time
	// Delay is how long Start waits before the launch check. Zero means
	// StartupDelay.
	Delay time.Duration
	// Check replaces the network call. Optional.
	Check func(ctx context.Context, version string, client *http.Client, mirrors []Mirror) (Result, error)
}

// Manager owns the update lifecycle.
type Manager struct {
	mu sync.Mutex

	version   string
	directory string
	policy    func() Policy
	emit      func(State)
	client    *http.Client
	commander Commander
	location  Location
	now       func() time.Time
	check     func(context.Context, string, *http.Client, []Mirror) (Result, error)
	delay     time.Duration

	state    State
	memory   memory
	busy     bool
	cancel   context.CancelFunc
	stop     chan struct{}
	stopOnce sync.Once
	// pending is the newest state the emitter has not sent yet, and notify
	// wakes it. One slot rather than a queue: a download publishes hundreds of
	// progress states and only the last of any burst is worth delivering.
	pending State
	notify  chan struct{}
}

// StartupDelay lets the launch sequence finish before anything is spent on a
// check nobody is waiting for.
const StartupDelay = 5 * time.Second

// CheckInterval is how often the background check runs while the application
// stays up. A launch checks regardless of when the last one was.
const CheckInterval = 24 * time.Hour

// isDevelopmentBuild reports a build with no release to compare against.
func isDevelopmentBuild(version string) bool {
	_, err := parseStableVersion(version)
	return err != nil
}

// New builds a Manager and restores what the last session left behind.
func New(options Options) *Manager {
	manager := &Manager{
		version:   options.Version,
		directory: options.Directory,
		policy:    options.Policy,
		emit:      options.Emit,
		client:    options.Client,
		commander: options.Commander,
		now:       options.Now,
		check:     options.Check,
		delay:     options.Delay,
		stop:      make(chan struct{}),
		notify:    make(chan struct{}, 1),
	}
	if manager.policy == nil {
		manager.policy = func() Policy { return PolicyNotify }
	}
	if manager.commander == nil {
		manager.commander = SystemCommander
	}
	if manager.now == nil {
		manager.now = time.Now
	}
	if manager.check == nil {
		manager.check = CheckLatest
	}
	if manager.delay <= 0 {
		manager.delay = StartupDelay
	}
	if options.Location != nil {
		manager.location = *options.Location
	} else {
		manager.location = Locate()
	}

	manager.memory = manager.readMemory()
	manager.state = State{
		Phase:          PhaseIdle,
		CurrentVersion: options.Version,
		Development:    isDevelopmentBuild(options.Version),
		Total:          -1,
		CheckedAt:      manager.memory.CheckedAt,
		Skipped:        manager.memory.Skipped,
		Location:       manager.location,
	}
	manager.restoreReady()
	if manager.emit != nil {
		go manager.pump()
	}
	return manager
}

// pump delivers state changes in order, one at a time, off the lock.
func (m *Manager) pump() {
	for {
		select {
		case <-m.stop:
			return
		case <-m.notify:
			m.mu.Lock()
			state := m.pending
			m.mu.Unlock()
			m.emit(state)
		}
	}
}

// restoreReady picks a finished download back up, or clears one that the
// running build has already overtaken.
func (m *Manager) restoreReady() {
	if m.memory.ReadyPath == "" {
		return
	}
	stale := true
	if _, err := os.Stat(m.memory.ReadyPath); err == nil {
		if comparison, err := CompareStable(m.version, m.memory.ReadyVersion); err == nil && comparison < 0 {
			stale = false
		}
	}
	if stale {
		// Either the install went through and this is the package it came
		// from, or the file is gone. Either way it is not an update any more.
		_ = os.Remove(m.memory.ReadyPath)
		m.memory.ReadyPath, m.memory.ReadyVersion = "", ""
		m.writeMemory()
		return
	}
	m.state.Phase = PhaseReady
	m.state.LatestVersion = m.memory.ReadyVersion
}

// State returns the current state.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshot()
}

// snapshot must be called with the lock held.
func (m *Manager) snapshot() State {
	state := m.state
	state.Policy = m.policy()
	return state
}

// publish hands the current state to the emitter. It must be called with the
// lock held; the emit itself happens on the pump, so a listener can neither
// deadlock the manager nor see two states out of order.
func (m *Manager) publish() {
	if m.emit == nil {
		return
	}
	m.pending = m.snapshot()
	select {
	case m.notify <- struct{}{}:
	default:
		// Already signalled: the pump will read whatever pending holds by then.
	}
}

func (m *Manager) setError(step FailedStep, err error) {
	m.state.Phase = PhaseError
	m.state.FailedStep = step
	m.state.Error = present(err).Error()
	m.publish()
}

// plan returns the mirrors to try, and the one to try first on its own when a
// recent race already picked a winner.
func (m *Manager) plan() ([]Mirror, *Mirror) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mirrors := MergeMirrors(BootstrapMirrors(), m.memory.LearnedMirrors)
	// With one mirror there is nothing to prefer: racing it is the same call.
	if m.memory.PreferredMirror == "" || len(mirrors) < 2 {
		return mirrors, nil
	}
	measured, err := time.Parse(time.RFC3339, m.memory.MirrorMeasured)
	if err != nil || m.now().Sub(measured) >= MirrorPreferenceTTL {
		// Re-measure rather than stay on a choice that may have gone bad, and
		// so a mirror added since the last race gets a chance to win.
		return mirrors, nil
	}
	if mirror, found := findMirror(mirrors, m.memory.PreferredMirror); found {
		return mirrors, &mirror
	}
	return mirrors, nil
}

// runCheck resolves the release, preferring whichever mirror answered last.
//
// The remembered winner is tried alone and briefly: when it answers, a routine
// check costs one request and no race at all. When it does not, being wrong
// costs that one request and the full race follows.
func (m *Manager) runCheck(ctx context.Context) (Result, error) {
	mirrors, preferred := m.plan()
	if preferred != nil {
		quick, cancel := context.WithTimeout(ctx, PreferenceTimeout)
		result, err := m.check(quick, m.version, m.client, []Mirror{*preferred})
		cancel()
		if err == nil {
			m.rememberMirror(result)
			return result, nil
		}
	}
	result, err := m.check(ctx, m.version, m.client, mirrors)
	if err == nil {
		m.rememberMirror(result)
	}
	return result, err
}

// rememberMirror records which mirror answered and folds in any the manifest
// named, so a mirror added to a later release reaches this build too.
func (m *Manager) rememberMirror(result Result) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if result.Mirror.Name != "" {
		m.memory.PreferredMirror = result.Mirror.Name
		m.memory.MirrorMeasured = m.now().UTC().Format(time.RFC3339)
	}
	if len(result.Manifest.Mirrors) > 0 {
		m.memory.LearnedMirrors = MergeMirrors(m.memory.LearnedMirrors, result.Manifest.Mirrors)
	}
	m.writeMemory()
}

// Check resolves the release and folds the answer into the state. A manual check
// reports every outcome; a scheduled one is silent unless something is found.
//
// When the policy downloads on its own and the check finds a release that is
// neither skipped nor already downloaded, the download starts before this
// returns to the caller -- in the background, so the call itself does not wait.
func (m *Manager) Check(ctx context.Context, manual bool) (State, error) {
	m.mu.Lock()
	if isDevelopmentBuild(m.version) {
		state := m.snapshot()
		m.mu.Unlock()
		return state, fmt.Errorf("this is a development build (%s), which has no release to compare against", m.version)
	}
	if m.busy {
		state := m.snapshot()
		m.mu.Unlock()
		return state, nil
	}
	m.busy = true
	m.state.Phase = PhaseChecking
	m.state.Error, m.state.FailedStep = "", StepNone
	m.publish()
	m.mu.Unlock()

	result, err := m.runCheck(ctx)

	m.mu.Lock()
	m.busy = false
	m.memory.CheckedAt = m.now().UTC().Format(time.RFC3339)
	m.state.CheckedAt = m.memory.CheckedAt
	if err != nil {
		m.writeMemory()
		m.setError(StepCheck, err)
		state := m.snapshot()
		m.mu.Unlock()
		return state, present(err)
	}

	m.state.ReleaseURL = result.ReleaseURL
	m.state.Outcome = result.Status
	// Asking for a check is the opposite of not wanting to hear about it, so a
	// manual one takes the release back off the skip list. Without this the
	// answer to the button is the "you are up to date" the skip bought, and a
	// release declined once could never be taken again.
	if manual && result.Status == StatusAvailable && m.memory.Skipped == result.LatestVersion {
		m.memory.Skipped, m.state.Skipped = "", ""
	}
	m.writeMemory()
	if result.Status != StatusAvailable {
		// Nothing newer: drop any release the state was still carrying so the
		// markers in the UI clear themselves.
		m.state.Phase = PhaseIdle
		m.state.LatestVersion = ""
		m.state.Notes, m.state.PublishedAt = "", ""
		m.publish()
		state := m.snapshot()
		m.mu.Unlock()
		return state, nil
	}

	m.state.LatestVersion = result.LatestVersion
	m.state.Notes = result.Notes
	m.state.PublishedAt = result.PublishedAt
	// A download from an earlier run is only still good if it is this release.
	if m.state.Phase == PhaseReady && m.memory.ReadyVersion == result.LatestVersion {
		m.publish()
		state := m.snapshot()
		m.mu.Unlock()
		return state, nil
	}
	m.state.Phase = PhaseAvailable
	m.publish()

	autoDownload := m.policy().downloads() &&
		m.location.CanInstall() &&
		result.LatestVersion != m.memory.Skipped
	state := m.snapshot()
	m.mu.Unlock()

	if autoDownload {
		go func() { _ = m.Download(context.WithoutCancel(ctx), result) }()
	}
	return state, nil
}

// Download fetches and verifies the package for a release. Passing the zero
// Result re-checks first, which is what the renderer's download button does.
func (m *Manager) Download(ctx context.Context, release Result) error {
	if release.LatestVersion == "" {
		checked, err := m.runCheck(ctx)
		if err != nil {
			m.mu.Lock()
			m.setError(StepDownload, err)
			m.mu.Unlock()
			return present(err)
		}
		if checked.Status != StatusAvailable {
			return nil
		}
		release = checked
	}

	m.mu.Lock()
	if m.busy {
		m.mu.Unlock()
		return nil
	}
	if !m.location.CanInstall() {
		err := fmt.Errorf("%w (%s)", ErrNotInstallable, m.location.Blocker)
		m.setError(StepDownload, err)
		m.mu.Unlock()
		return present(err)
	}
	m.busy = true
	downloadCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.state.Phase = PhaseDownloading
	m.state.LatestVersion = release.LatestVersion
	m.state.Notes, m.state.PublishedAt = release.Notes, release.PublishedAt
	m.state.Downloaded, m.state.Total = 0, -1
	m.state.Error, m.state.FailedStep = "", StepNone
	m.publish()
	client, location, directory := m.client, m.location, m.directory
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		m.busy = false
		m.cancel = nil
		m.mu.Unlock()
		cancel()
	}()

	path, err := m.fetch(downloadCtx, client, location, directory, release)
	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil {
		if errors.Is(err, context.Canceled) {
			// A cancel is the user's answer, not a failure to report.
			m.state.Phase = PhaseAvailable
			m.state.Downloaded, m.state.Total = 0, -1
			m.publish()
			return nil
		}
		m.setError(StepDownload, err)
		return present(err)
	}
	m.memory.ReadyVersion, m.memory.ReadyPath = release.LatestVersion, path
	m.writeMemory()
	m.state.Phase = PhaseReady
	m.publish()
	return nil
}

// fetch resolves this build's package from the manifest and downloads it,
// trying each mirror in turn and leaving the verified file on disk.
//
// Falling through to another mirror is safe because of the digest the manifest
// published: a mirror carries bytes but does not get to say what they are, so
// the worst a bad one costs is the attempt. That is also why the digest is in
// the manifest rather than in a file fetched next to the package -- otherwise
// whoever served the package would be attesting to it as well.
func (m *Manager) fetch(
	ctx context.Context,
	client *http.Client,
	location Location,
	directory string,
	release Result,
) (string, error) {
	name := location.Target.PackageName(release.LatestVersion)
	file, listed := release.Manifest.Files[name]
	if !listed {
		return "", fmt.Errorf("release %s has no package for this platform (%s)", release.LatestVersion, name)
	}
	mirrors := release.Order
	if len(mirrors) == 0 {
		mirrors = []Mirror{release.Mirror}
	}

	// Old packages are of no use once a newer one is being fetched, and they
	// are the largest thing the app ever writes.
	m.sweep(directory, name)

	path := filepath.Join(directory, name)
	progress := func(done, total int64) {
		m.mu.Lock()
		m.state.Downloaded, m.state.Total = done, total
		m.publish()
		m.mu.Unlock()
	}

	failure := newMirrorFailure(name + " could not be downloaded")
	for _, mirror := range mirrors {
		m.mu.Lock()
		m.state.Mirror = mirror.Name
		// Each attempt starts from nothing, so the bar does not appear to run
		// backwards when one mirror gives up partway.
		m.state.Downloaded, m.state.Total = 0, -1
		m.publish()
		m.mu.Unlock()

		err := Download(ctx, client, mirror.AssetURL(file.Path), path, file.SHA256, progress)
		if err == nil {
			return path, nil
		}
		// A cancel is the user's answer and applies to every mirror.
		if errors.Is(err, context.Canceled) {
			return "", err
		}
		failure.add(mirror, err)
	}
	return "", failure
}

// checksumAssetName is what the release workflow attaches the digests as.
const checksumAssetName = "SHA256SUMS.txt"

// sweep removes abandoned packages from the download directory. The updater's
// own memory lives here too and is not one of them: sweeping it away would
// lose the skip list and the check throttle every time a download started.
func (m *Manager) sweep(directory, keep string) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() == keep || entry.Name() == memoryFile {
			continue
		}
		_ = os.Remove(filepath.Join(directory, entry.Name()))
	}
}

// Cancel stops a download in flight. It is a no-op otherwise.
func (m *Manager) Cancel() {
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Install applies the downloaded package and arranges for the application to
// come back. The caller quits once this returns: the running image is what has
// just been replaced.
func (m *Manager) Install(ctx context.Context) error {
	m.mu.Lock()
	if m.state.Phase != PhaseReady || m.memory.ReadyPath == "" {
		m.mu.Unlock()
		return errors.New("no downloaded update is ready to install")
	}
	m.state.Phase = PhaseInstalling
	m.publish()
	path, location, commander := m.memory.ReadyPath, m.location, m.commander
	m.mu.Unlock()

	if err := Apply(ctx, commander, location, path); err != nil {
		m.mu.Lock()
		m.state.Phase = PhaseReady
		m.setError(StepInstall, err)
		m.mu.Unlock()
		return present(err)
	}

	m.mu.Lock()
	m.forgetReady()
	m.mu.Unlock()
	return Relaunch(commander, location)
}

// InstallOnQuit applies a ready package without relaunching, for the auto
// policy: the swap happens as the application closes, and the next launch is
// the new version. It reports whether anything was installed.
func (m *Manager) InstallOnQuit(ctx context.Context) (bool, error) {
	m.mu.Lock()
	ready := m.state.Phase == PhaseReady && m.memory.ReadyPath != ""
	if !ready || m.policy() != PolicyAuto {
		m.mu.Unlock()
		return false, nil
	}
	path, location, commander := m.memory.ReadyPath, m.location, m.commander
	m.mu.Unlock()

	if err := Apply(ctx, commander, location, path); err != nil {
		return false, present(err)
	}
	m.mu.Lock()
	m.forgetReady()
	m.mu.Unlock()
	return true, nil
}

// forgetReady drops the finished package from both the state and the disk. It
// must be called with the lock held.
func (m *Manager) forgetReady() {
	_ = os.Remove(m.memory.ReadyPath)
	m.memory.ReadyPath, m.memory.ReadyVersion = "", ""
	m.writeMemory()
	m.state.Phase = PhaseIdle
	m.state.Downloaded, m.state.Total = 0, -1
}

// Skip stops a release from being announced again. The next one still is.
func (m *Manager) Skip(version string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.memory.Skipped = version
	m.state.Skipped = version
	m.writeMemory()
	m.publish()
}

// Start runs the background schedule until Close. Every launch checks, once
// StartupDelay has let the window come up, and every CheckInterval after that.
//
// A launch used to wait out whatever was left of the interval instead. An
// application that is opened and closed a few times a day never reaches the end
// of one, so the only check that ever ran was the one the user pressed for --
// which is no way to hear about a release.
func (m *Manager) Start(ctx context.Context) {
	if isDevelopmentBuild(m.version) {
		return
	}
	go func() {
		timer := time.NewTimer(m.delay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-m.stop:
				return
			case <-timer.C:
			}
			if m.policy() != PolicyOff {
				_, _ = m.Check(ctx, false)
			}
			timer.Reset(CheckInterval)
		}
	}()
}

// Close stops the schedule and any download in flight.
func (m *Manager) Close() {
	m.stopOnce.Do(func() { close(m.stop) })
	m.Cancel()
}

// memoryFile is where the bits that outlive a session are kept.
const memoryFile = "update.json"

func (m *Manager) memoryPath() string { return filepath.Join(m.directory, memoryFile) }

func (m *Manager) readMemory() memory {
	content, err := os.ReadFile(m.memoryPath())
	if err != nil {
		return memory{}
	}
	var stored memory
	if err := json.Unmarshal(content, &stored); err != nil {
		return memory{}
	}
	return stored
}

// writeMemory must be called with the lock held. A failure costs the throttle
// and the skip list, so there is nothing to recover here.
func (m *Manager) writeMemory() {
	if err := os.MkdirAll(m.directory, 0o755); err != nil {
		return
	}
	content, err := json.Marshal(m.memory)
	if err != nil {
		return
	}
	_ = os.WriteFile(m.memoryPath(), content, 0o600)
}
