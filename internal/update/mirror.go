package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

/*
 * Where a release can be fetched from, and how the app decides which one to use.
 *
 * Every mirror serves the same two things: the manifest that says what the
 * latest release is, and the packages it names. Which mirror answers is decided
 * here, at runtime, on the user's own network -- because that is the only place
 * the answer exists. A release host can be reachable from one network and
 * blocked on the next, and neither DNS nor a server-side redirect can see that;
 * a server that routes traffic is itself something that can be unreachable.
 *
 * The manifest doubles as the probe. It is a few KB, every mirror has to serve
 * it, and a check has to fetch it anyway -- so racing mirrors for it measures
 * reachability at no extra cost, and the winner is handed the package download
 * that follows.
 */

// Mirror is one place a release can be fetched from. The two URLs are separate
// because they need not share a prefix: GitHub serves the manifest from the
// latest release and the packages from a tag directory.
type Mirror struct {
	Name        string `json:"name"`
	ManifestURL string `json:"manifest"`
	AssetBase   string `json:"assets"`
}

// MirrorStagger is how long each mirror gets before the next one is started.
// It is what keeps a healthy first choice from costing anything: when the
// preferred mirror answers inside this window, no other request is ever made.
const MirrorStagger = 400 * time.Millisecond

// RaceTimeout bounds a whole race, so one mirror that accepts a connection and
// then says nothing cannot hold up the check indefinitely.
const RaceTimeout = 12 * time.Second

// PreferenceTimeout is how long a mirror that won last time gets to answer on
// its own before the full race starts. Short on purpose: the cost of being
// wrong is one wasted request, and the cost of waiting is the whole check.
const PreferenceTimeout = 2 * time.Second

// MirrorPreferenceTTL is how long a remembered winner is reused without being
// re-measured. It bounds two opposite mistakes: staying on a mirror that has
// since got worse, and never discovering one that was added later.
const MirrorPreferenceTTL = 7 * 24 * time.Hour

// maxManifestBytes caps the manifest, which is a few KB of metadata plus the
// release notes.
const maxManifestBytes = 1 << 20

// SupportedSchema is the newest manifest layout this build understands. A
// manifest above it is refused rather than guessed at, which is what lets an
// old build say "download it by hand" instead of misreading a future release.
const SupportedSchema = 1

// BootstrapMirrors is the list compiled into the build. Anything learned from a
// manifest is added to it and can never replace it, so a build always retains a
// path it was shipped knowing about.
func BootstrapMirrors() []Mirror {
	return []Mirror{
		{
			Name:        "r2",
			ManifestURL: "https://dl.amigoer.com/latest.json",
			AssetBase:   "https://dl.amigoer.com",
		},
		{
			Name:        "github",
			ManifestURL: "https://github.com/amigoer/mq-studio/releases/latest/download/manifest.json",
			AssetBase:   "https://github.com/amigoer/mq-studio/releases/download",
		},
	}
}

// AssetURL resolves a manifest path against this mirror.
func (m Mirror) AssetURL(path string) string {
	return strings.TrimSuffix(m.AssetBase, "/") + "/" + strings.TrimPrefix(path, "/")
}

// Valid reports whether a mirror is usable. Plain HTTP is rejected: a mirror
// carries the digests that authorise an install, so the transport is the only
// thing standing between a hostile network and a chosen update.
func (m Mirror) Valid() bool {
	return m.Name != "" &&
		strings.HasPrefix(m.ManifestURL, "https://") &&
		strings.HasPrefix(m.AssetBase, "https://")
}

// ManifestFile is one package in a release.
type ManifestFile struct {
	// Path is relative to a mirror's AssetBase, which is what lets one manifest
	// describe every mirror.
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Manifest is the release description every mirror serves. It replaces the
// GitHub releases API: the digests are inlined rather than left in a separate
// SHA256SUMS.txt, so it is the only thing a client has to trust and the only
// request a check has to make.
type Manifest struct {
	Schema      int                     `json:"schema"`
	Version     string                  `json:"version"`
	Tag         string                  `json:"tag"`
	PublishedAt string                  `json:"publishedAt"`
	ReleaseURL  string                  `json:"releaseURL"`
	Notes       string                  `json:"notes"`
	Mirrors     []Mirror                `json:"mirrors"`
	Checksums   string                  `json:"checksums"`
	Files       map[string]ManifestFile `json:"files"`
	// Signature is reserved for an ed25519 signature over this object. Empty
	// means unsigned, which is accepted while every mirror is first-party.
	Signature string `json:"signature"`
}

// ErrSchemaTooNew reports a manifest written for a later build than this one.
var ErrSchemaTooNew = errors.New("this build is too old to read the release index")

// Fetched is a manifest and where it came from.
type Fetched struct {
	Manifest Manifest
	// Mirror is the one that answered, and where the download starts.
	Mirror Mirror
	// Order is the winner followed by the rest in preference order, which is
	// the sequence a download falls through on failure.
	Order []Mirror
}

// ParseManifest reads and checks a manifest. A mirror that answers with
// something malformed is treated as a failure, so the race moves on to the next
// one rather than the app acting on half a release.
func ParseManifest(content []byte) (Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("unreadable release index: %w", err)
	}
	if manifest.Schema > SupportedSchema {
		return Manifest{}, fmt.Errorf("%w (schema %d); download it from %s",
			ErrSchemaTooNew, manifest.Schema, DownloadsURL)
	}
	if manifest.Schema < 1 {
		return Manifest{}, errors.New("the release index does not say which schema it uses")
	}
	if _, err := parseStableVersion(manifest.Version); err != nil {
		return Manifest{}, fmt.Errorf("the release index names no stable version: %q", manifest.Version)
	}
	if len(manifest.Files) == 0 {
		return Manifest{}, errors.New("the release index lists no packages")
	}
	for name, file := range manifest.Files {
		if file.Path == "" {
			return Manifest{}, fmt.Errorf("%s has no path in the release index", name)
		}
		if len(file.SHA256) != hexSHA256 {
			return Manifest{}, fmt.Errorf("%s has no usable checksum in the release index", name)
		}
	}
	return manifest, nil
}

// FetchManifest reads one mirror's manifest.
func FetchManifest(ctx context.Context, client *http.Client, mirror Mirror) (Manifest, error) {
	response, err := get(ctx, client, mirror.ManifestURL)
	if err != nil {
		return Manifest{}, err
	}
	defer func() { _ = response.Body.Close() }()

	content, err := io.ReadAll(io.LimitReader(response.Body, maxManifestBytes))
	if err != nil {
		return Manifest{}, err
	}
	return ParseManifest(content)
}

// RaceManifest starts each mirror stagger apart and returns the first manifest
// to arrive, cancelling the rest.
//
// Starting them apart rather than together is the whole point: with a working
// first choice the later requests are never made, so having several mirrors
// costs nothing until one is actually needed.
func RaceManifest(
	ctx context.Context,
	client *http.Client,
	mirrors []Mirror,
	stagger time.Duration,
) (Fetched, error) {
	usable := make([]Mirror, 0, len(mirrors))
	for _, mirror := range mirrors {
		if mirror.Valid() {
			usable = append(usable, mirror)
		}
	}
	if len(usable) == 0 {
		return Fetched{}, errors.New("no usable mirror is configured")
	}

	ctx, cancel := context.WithTimeout(ctx, RaceTimeout)
	defer cancel()

	type outcome struct {
		mirror   Mirror
		manifest Manifest
		err      error
	}
	// Buffered for every mirror so a goroutine whose race is already decided
	// still finishes rather than blocking on a send nobody will read.
	results := make(chan outcome, len(usable))
	for index, mirror := range usable {
		go func(index int, mirror Mirror) {
			if delay := time.Duration(index) * stagger; delay > 0 {
				timer := time.NewTimer(delay)
				defer timer.Stop()
				select {
				case <-ctx.Done():
					results <- outcome{mirror: mirror, err: ctx.Err()}
					return
				case <-timer.C:
				}
			}
			manifest, err := FetchManifest(ctx, client, mirror)
			results <- outcome{mirror: mirror, manifest: manifest, err: err}
		}(index, mirror)
	}

	failure := newMirrorFailure("no mirror could be reached")
	for range usable {
		got := <-results
		if got.err == nil {
			return Fetched{
				Manifest: got.manifest,
				Mirror:   got.mirror,
				Order:    orderFrom(usable, got.mirror),
			}, nil
		}
		// A manifest this build cannot read will not read any better from
		// another mirror, so say so instead of trying them all.
		if errors.Is(got.err, ErrSchemaTooNew) {
			return Fetched{}, got.err
		}
		failure.add(got.mirror, got.err)
	}
	return Fetched{}, failure
}

// mirrorFailure reports that every mirror was tried and none of them worked.
//
// It reads as one line, because it reaches the user as one line, while keeping
// each underlying error reachable through errors.Is -- a caller still has to be
// able to tell a checksum mismatch from a network failure, and folding the
// mirrors into a string would have thrown that away.
type mirrorFailure struct {
	what    string
	reasons []string
	errs    []error
}

func newMirrorFailure(what string) *mirrorFailure { return &mirrorFailure{what: what} }

func (f *mirrorFailure) add(mirror Mirror, err error) {
	f.reasons = append(f.reasons, mirror.Name+": "+err.Error())
	f.errs = append(f.errs, err)
}

func (f *mirrorFailure) Error() string {
	return fmt.Sprintf("%s (%s)", f.what, strings.Join(f.reasons, "; "))
}

func (f *mirrorFailure) Unwrap() []error { return f.errs }

// orderFrom puts the winner first and keeps the rest in preference order.
// Only the winner's position is measured -- the others were cancelled before
// they could answer -- so the configured order is all that is known about them.
func orderFrom(mirrors []Mirror, winner Mirror) []Mirror {
	order := make([]Mirror, 0, len(mirrors))
	order = append(order, winner)
	for _, mirror := range mirrors {
		if mirror.Name != winner.Name {
			order = append(order, mirror)
		}
	}
	return order
}

// MergeMirrors folds a manifest's mirror list into the ones already known.
//
// Merging only: an entry from a manifest can neither remove a mirror nor
// redefine one that is already known. That bounds what a manifest can do to the
// list to adding a mirror it already served itself, and keeps the compiled-in
// path reachable no matter what any mirror says.
func MergeMirrors(known, learned []Mirror) []Mirror {
	merged := make([]Mirror, 0, len(known)+len(learned))
	seen := make(map[string]bool, len(known)+len(learned))
	for _, mirror := range known {
		if mirror.Valid() && !seen[mirror.Name] {
			seen[mirror.Name] = true
			merged = append(merged, mirror)
		}
	}
	for _, mirror := range learned {
		if mirror.Valid() && !seen[mirror.Name] {
			seen[mirror.Name] = true
			merged = append(merged, mirror)
		}
	}
	return merged
}

// findMirror returns the named mirror from a list.
func findMirror(mirrors []Mirror, name string) (Mirror, bool) {
	for _, mirror := range mirrors {
		if mirror.Name == name {
			return mirror, true
		}
	}
	return Mirror{}, false
}
