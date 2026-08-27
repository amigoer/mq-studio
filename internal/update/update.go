// Package update compares the running build against the latest GitHub release.
package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ReleasesURL is the human-facing downloads page.
const ReleasesURL = "https://github.com/amigoer/mq-studio/releases/latest"

const latestReleaseAPI = "https://api.github.com/repos/amigoer/mq-studio/releases/latest"

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

type releasePayload struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// CheckLatest queries the GitHub latest release and compares it to current.
func CheckLatest(currentVersion string, client *http.Client) (Result, error) {
	current, err := parseStableVersion(currentVersion)
	if err != nil {
		return Result{}, err
	}
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}

	request, err := http.NewRequest(http.MethodGet, latestReleaseAPI, nil)
	if err != nil {
		return Result{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "MQ-Studio/"+current.normalized)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	response, err := client.Do(request)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Result{}, fmt.Errorf("GitHub latest release request failed (%d)", response.StatusCode)
	}

	var payload releasePayload
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return Result{}, errors.New("GitHub latest release response is missing tag_name")
	}
	if strings.TrimSpace(payload.TagName) == "" {
		return Result{}, errors.New("GitHub latest release response is missing tag_name")
	}
	if payload.Draft || payload.Prerelease {
		return Result{}, errors.New("GitHub latest release response is not a stable release")
	}

	latest, err := parseStableVersion(payload.TagName)
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
	}, nil
}
