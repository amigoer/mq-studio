package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

/*
 * Fetching and verifying a release asset.
 *
 * Every release carries a SHA256SUMS.txt that each packaging job hashed on the
 * runner that produced its own file, so the checksum is the only thing standing
 * between a downloaded installer and being run. Nothing is applied without it:
 * an asset whose name is absent from the list is treated as a failure, not as
 * an unverified success.
 */

// userAgent identifies the app to GitHub. CheckLatest appends the running
// version to it; the asset downloads run before any version is in hand.
const userAgent = "MQ-Studio"

// hexSHA256 is the digest length the checksum file uses.
const hexSHA256 = sha256.Size * 2

// maxChecksumBytes caps the checksum file, which lists a dozen short lines.
const maxChecksumBytes = 64 << 10

// ErrChecksumMismatch reports a download whose content is not what the release
// attested to. The partial file is removed before it is returned.
var ErrChecksumMismatch = errors.New("downloaded file does not match its published checksum")

// ParseChecksums reads `shasum -a 256` output into name -> digest. Names are
// accepted with the `*` binary marker or a `./` prefix, both of which the
// tooling that writes these files can emit.
func ParseChecksums(content string) map[string]string {
	sums := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		digest := strings.ToLower(fields[0])
		if len(digest) != hexSHA256 {
			continue
		}
		if _, err := hex.DecodeString(digest); err != nil {
			continue
		}
		name := strings.TrimPrefix(strings.TrimPrefix(fields[1], "*"), "./")
		if name == "" {
			continue
		}
		sums[name] = digest
	}
	return sums
}

// FetchChecksums downloads and parses a release's SHA256SUMS.txt.
func FetchChecksums(ctx context.Context, client *http.Client, url string) (map[string]string, error) {
	response, err := get(ctx, client, url)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()

	content, err := io.ReadAll(io.LimitReader(response.Body, maxChecksumBytes))
	if err != nil {
		return nil, err
	}
	sums := ParseChecksums(string(content))
	if len(sums) == 0 {
		return nil, errors.New("the release checksum list is empty or unreadable")
	}
	return sums, nil
}

func get(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	if client == nil {
		client = http.DefaultClient
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", userAgent)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = response.Body.Close()
		return nil, fmt.Errorf("download failed (%d): %s", response.StatusCode, url)
	}
	return response, nil
}

// Download fetches url into dest and verifies it against want, a lowercase hex
// SHA-256. progress may be nil; total is -1 while the server sends no length.
//
// The bytes land in a sibling `.part` file and are renamed into place only
// after the digest matches, so dest never names a half-written or wrong file.
func Download(
	ctx context.Context,
	client *http.Client,
	url, dest, want string,
	progress func(done, total int64),
) error {
	if len(want) != hexSHA256 {
		return fmt.Errorf("refusing to download %s without a published checksum", filepath.Base(dest))
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}

	response, err := get(ctx, client, url)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	partial := dest + ".part"
	file, err := os.Create(partial)
	if err != nil {
		return err
	}
	// Named so the failure paths below can drop the partial file; the success
	// path renames it away first, which makes this a no-op.
	defer func() {
		_ = file.Close()
		_ = os.Remove(partial)
	}()

	digest := sha256.New()
	// ContentLength is -1 when the server sends none, which is exactly what a
	// caller drawing an indeterminate bar wants to see.
	written, err := copyWithProgress(
		ctx, io.MultiWriter(file, digest), response.Body, response.ContentLength, progress)
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}

	if got := hex.EncodeToString(digest.Sum(nil)); !strings.EqualFold(got, want) {
		return fmt.Errorf("%w: %s (%d bytes)", ErrChecksumMismatch, filepath.Base(dest), written)
	}
	// Windows will not rename onto an existing file.
	_ = os.Remove(dest)
	return os.Rename(partial, dest)
}

// progressInterval is how many bytes pass between progress reports. A 100 MB
// image reports about 500 times, which is enough for a smooth bar and few
// enough to not flood the renderer with events.
const progressInterval = 200 << 10

func copyWithProgress(
	ctx context.Context,
	destination io.Writer,
	source io.Reader,
	total int64,
	progress func(done, total int64),
) (int64, error) {
	buffer := make([]byte, 64<<10)
	var done, sinceReport int64
	for {
		if err := ctx.Err(); err != nil {
			return done, err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			if _, err := destination.Write(buffer[:read]); err != nil {
				return done, err
			}
			done += int64(read)
			sinceReport += int64(read)
			if progress != nil && sinceReport >= progressInterval {
				sinceReport = 0
				progress(done, total)
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				if progress != nil {
					progress(done, total)
				}
				return done, nil
			}
			return done, readErr
		}
	}
}
