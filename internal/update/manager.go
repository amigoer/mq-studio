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

// Announceable reports whether the state describes a release worth putting in
// front of the user: newer, not skipped, and not one they have been shown.
func (s State) Announceable() bool {
	return s.LatestVersion != "" && s.LatestVersion != s.Skipped
}

// memory is the part of State that has to survive a restart: what was already
// checked and skipped, and a package that finished downloading but was never
// installed.
type memory struct {
	CheckedAt    string `json:"checkedAt"`
	Skipped      string `json:"skipped"`
	ReadyVersion string `json:"readyVersion"`
	ReadyPath    string `json:"readyPath"`
	// The release a toast has already announced, so restarting does not
	// re-announce a version the user has already declined once.
	Announced string `json:"announced"`
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
	// Client, Commander, Location and Now are seams for the tests.
	Client    *http.Client
	Commander Commander
	Location  *Location
	Now       func() time.Time
	// Check replaces the GitHub call. Optional.
	Check func(version string, client *http.Client) (Result, error)
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
	check     func(string, *http.Client) (Result, error)

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

// CheckInterval is how often the background check runs. A check is also made
// at startup when this much has passed since the last one.
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
	m.state.Error = err.Error()
	m.publish()
}

// Check queries GitHub and folds the answer into the state. A manual check
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
	client, check := m.client, m.check
	m.mu.Unlock()

	result, err := check(m.version, client)

	m.mu.Lock()
	m.busy = false
	m.memory.CheckedAt = m.now().UTC().Format(time.RFC3339)
	m.state.CheckedAt = m.memory.CheckedAt
	m.writeMemory()
	if err != nil {
		m.setError(StepCheck, err)
		state := m.snapshot()
		m.mu.Unlock()
		return state, err
	}

	m.state.ReleaseURL = result.ReleaseURL
	m.state.Outcome = result.Status
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
		checked, err := m.check(m.version, m.client)
		if err != nil {
			m.mu.Lock()
			m.setError(StepDownload, err)
			m.mu.Unlock()
			return err
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
		return err
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
		return err
	}
	m.memory.ReadyVersion, m.memory.ReadyPath = release.LatestVersion, path
	m.writeMemory()
	m.state.Phase = PhaseReady
	m.publish()
	return nil
}

// fetch resolves this build's asset, verifies it against the release's own
// checksum list and leaves the package on disk.
func (m *Manager) fetch(
	ctx context.Context,
	client *http.Client,
	location Location,
	directory string,
	release Result,
) (string, error) {
	name := location.Target.PackageName(release.LatestVersion)
	asset, found := release.Find(name)
	if !found {
		return "", fmt.Errorf("release %s has no package for this platform (%s)", release.LatestVersion, name)
	}
	sumsAsset, found := release.Find(checksumAssetName)
	if !found {
		return "", fmt.Errorf("release %s publishes no %s", release.LatestVersion, checksumAssetName)
	}
	sums, err := FetchChecksums(ctx, client, sumsAsset.URL)
	if err != nil {
		return "", err
	}
	want, listed := sums[name]
	if !listed {
		return "", fmt.Errorf("%s is not listed in %s", name, checksumAssetName)
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
	if err := Download(ctx, client, asset.URL, path, want, progress); err != nil {
		return "", err
	}
	return path, nil
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
		return err
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
		return false, err
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

// Announced records that the user has been told about a release, so a restart
// does not put the same one in front of them again.
func (m *Manager) Announced() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.memory.Announced
}

// MarkAnnounced records the release the user has now been shown.
func (m *Manager) MarkAnnounced(version string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.memory.Announced == version {
		return
	}
	m.memory.Announced = version
	m.writeMemory()
}

// Start runs the background schedule until Close. The first check waits out
// whatever is left of the interval, with StartupDelay as the floor so a launch
// is never slowed by it.
func (m *Manager) Start(ctx context.Context) {
	if isDevelopmentBuild(m.version) {
		return
	}
	go func() {
		delay := StartupDelay
		if since, ok := m.sinceLastCheck(); ok {
			if remaining := CheckInterval - since; remaining > delay {
				delay = remaining
			}
		}
		timer := time.NewTimer(delay)
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

func (m *Manager) sinceLastCheck() (time.Duration, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.memory.CheckedAt == "" {
		return 0, false
	}
	at, err := time.Parse(time.RFC3339, m.memory.CheckedAt)
	if err != nil {
		return 0, false
	}
	return m.now().Sub(at), true
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
