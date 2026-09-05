package update

import "errors"

/*
 * Turning a failure into something the renderer can put in front of a reader.
 *
 * Most of what goes wrong here is worth showing as written: the mirror that
 * timed out, an HTTP status, a path. That detail is what makes a report useful,
 * and a translation would throw it away. A few failures are the opposite --
 * their meaning is closed and identical every time, and the English sentence in
 * the sentinel is the wrong thing to show someone who does not read English.
 *
 * Only those become i18n keys. The renderer already tells a key from a sentence
 * (isI18nKey in lib/utils.ts), so a failure with no key still arrives as its
 * own message rather than as a missing translation.
 */

// presented carries an i18n key as its message while keeping the failure it
// describes reachable through errors.Is.
type presented struct {
	key string
	err error
}

func (p presented) Error() string { return p.key }
func (p presented) Unwrap() error { return p.err }

// reasonKeys is every failure with a fixed enough meaning to translate, and
// every key this package can emit. Anything absent is shown as written, which
// is the right default: inventing a key for a failure nobody has characterised
// would replace a specific message with a vaguer one.
//
// TestEveryReasonKeyIsTranslated checks the renderer's bundles carry all of
// them. A key emitted with no translation behind it reaches the user as the
// dotted name itself, and nothing on the TypeScript side can catch that -- the
// keys are written here, not there.
var reasonKeys = []struct {
	err error
	key string
}{
	{ErrElevationDeclined, "update.error.elevationDeclined"},
	{ErrNotInstallable, "update.error.notInstallable"},
	{ErrSchemaTooNew, "update.error.schemaTooNew"},
}

// ErrChecksumMismatch is deliberately not here. It reaches a reader wrapped in
// the failure that names which mirrors served the bad bytes, and that is the
// whole content of the report -- a key would flatten every mirror into one
// sentence that says nothing about where to look next.
// TestEveryMirrorLyingStillReportsAChecksumMismatch is what holds that.

func reasonKey(err error) string {
	for _, candidate := range reasonKeys {
		if errors.Is(err, candidate.err) {
			return candidate.key
		}
	}
	return ""
}

// present swaps a known failure's message for its key, at the edge where the
// renderer is the only reader left. Both the published state and the value the
// binding rejects with go through it, so the dialog and the toast cannot end up
// saying different things about one failure.
func present(err error) error {
	if err == nil {
		return nil
	}
	var already presented
	if errors.As(err, &already) {
		return err
	}
	if key := reasonKey(err); key != "" {
		return presented{key: key, err: err}
	}
	return err
}
