// Package update compares the running build against the latest published release.
package update

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DownloadsURL is the human-facing downloads page. It points at the site rather
// than at GitHub Releases: the site offers the same packages and is reachable on
// networks that cannot open github.com.
const DownloadsURL = "https://mq-studio.amigoer.com/#download"

const requestTimeout = 10 * time.Second

// stableSemVer accepts stable releases only: pre-release identifiers are
// rejected so that beta tags never prompt an update.
var stableSemVer = regexp.MustCompile(`^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

// Status reports how the running build relates to the latest release.
type Status string

const (
	// StatusAvailable means a newer release exists.
	StatusAvailable Status = "available"
	// StatusCurrent means the running build is the latest release.
	StatusCurrent Status = "current"
	// StatusAhead means the running build is newer than the latest release.
	StatusAhead Status = "ahead"
)

// Result is the outcome of an update check.
type Result struct {
	Status         Status `json:"status"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	// Release notes, as written in the changelog the workflow publishes.
	Notes string `json:"notes"`
	// RFC3339, or empty when the release names no publication date.
	PublishedAt string `json:"publishedAt"`
	ReleaseURL  string `json:"releaseURL"`
	// Manifest is the whole release as the winning mirror described it.
	// Resolving which package this build installs is the caller's job --
	// CheckLatest knows nothing about the host it is running on.
	Manifest Manifest `json:"manifest"`
	// Mirror answered the check and is where the download starts; Order is the
	// sequence to fall through if it stops answering partway.
	Mirror Mirror   `json:"mirror"`
	Order  []Mirror `json:"order"`
}

type stableVersion struct {
	normalized string
	parts      [3]uint64
}

func parseStableVersion(value string) (stableVersion, error) {
	match := stableSemVer.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return stableVersion{}, fmt.Errorf("invalid stable SemVer: %s", value)
	}
	var parts [3]uint64
	for index := 0; index < 3; index++ {
		parsed, err := strconv.ParseUint(match[index+1], 10, 64)
		if err != nil {
			return stableVersion{}, fmt.Errorf("invalid stable SemVer: %s", value)
		}
		parts[index] = parsed
	}
	return stableVersion{
		normalized: fmt.Sprintf("%d.%d.%d", parts[0], parts[1], parts[2]),
		parts:      parts,
	}, nil
}

// CompareStable orders two stable SemVer strings numerically.
func CompareStable(left, right string) (int, error) {
	leftVersion, err := parseStableVersion(left)
	if err != nil {
		return 0, err
	}
	rightVersion, err := parseStableVersion(right)
	if err != nil {
		return 0, err
	}
	for index := range leftVersion.parts {
		if leftVersion.parts[index] < rightVersion.parts[index] {
			return -1, nil
		}
		if leftVersion.parts[index] > rightVersion.parts[index] {
			return 1, nil
		}
	}
	return 0, nil
}

func statusFromComparison(comparison int) Status {
	switch {
	case comparison < 0:
		return StatusAvailable
	case comparison > 0:
		return StatusAhead
	default:
		return StatusCurrent
	}
}

// CheckLatest races the mirrors for the release manifest and compares what the
// winner reports to the running build. An empty mirror list falls back to the
// ones compiled in.
//
// It takes the whole list rather than one URL because reaching a release is the
// thing that fails: the check and the download that follows both go to whichever
// mirror answers, and that is not knowable ahead of time.
func CheckLatest(
	ctx context.Context,
	currentVersion string,
	client *http.Client,
	mirrors []Mirror,
) (Result, error) {
	current, err := parseStableVersion(currentVersion)
	if err != nil {
		return Result{}, err
	}
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}
	if len(mirrors) == 0 {
		mirrors = BootstrapMirrors()
	}

	fetched, err := RaceManifest(ctx, client, mirrors, MirrorStagger)
	if err != nil {
		return Result{}, err
	}

	latest, err := parseStableVersion(fetched.Manifest.Version)
	if err != nil {
		return Result{}, err
	}
	comparison, err := CompareStable(current.normalized, latest.normalized)
	if err != nil {
		return Result{}, err
	}
	return Result{
		Status:         statusFromComparison(comparison),
		CurrentVersion: current.normalized,
		LatestVersion:  latest.normalized,
		Notes:          strings.TrimSpace(fetched.Manifest.Notes),
		PublishedAt:    strings.TrimSpace(fetched.Manifest.PublishedAt),
		ReleaseURL:     strings.TrimSpace(fetched.Manifest.ReleaseURL),
		Manifest:       fetched.Manifest,
		Mirror:         fetched.Mirror,
		Order:          fetched.Order,
	}, nil
}
