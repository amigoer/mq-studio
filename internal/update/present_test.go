package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// lookup walks a dotted key through a decoded bundle.
func lookup(bundle map[string]any, key string) (string, bool) {
	var node any = bundle
	for _, segment := range strings.Split(key, ".") {
		object, ok := node.(map[string]any)
		if !ok {
			return "", false
		}
		if node, ok = object[segment]; !ok {
			return "", false
		}
	}
	text, ok := node.(string)
	return text, ok
}

// A key with no translation behind it reaches the user as the dotted name
// itself. Nothing on the TypeScript side can catch that: keys.test.ts reads
// literal t("...") calls out of the sources, and these keys are written here.
func TestEveryReasonKeyIsTranslated(t *testing.T) {
	for _, language := range []string{"en", "zh"} {
		path := filepath.Join("..", "..", "frontend", "src", "i18n", "locales", language+".json")
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("reading %s: %v", path, err)
		}
		var bundle map[string]any
		if err := json.Unmarshal(content, &bundle); err != nil {
			t.Fatalf("%s is not readable: %v", path, err)
		}
		for _, candidate := range reasonKeys {
			text, ok := lookup(bundle, candidate.key)
			if !ok {
				t.Errorf("%s has no %s", path, candidate.key)
				continue
			}
			if strings.TrimSpace(text) == "" {
				t.Errorf("%s translates %s to nothing", path, candidate.key)
			}
		}
	}
}

// The renderer decides what to translate by looking at the string, so a key
// that does not look like one is shown to the user verbatim.
func TestReasonKeysLookLikeKeys(t *testing.T) {
	for _, candidate := range reasonKeys {
		if !strings.HasPrefix(candidate.key, "update.error.") {
			t.Errorf("%q is outside the update.error namespace", candidate.key)
		}
		if strings.ContainsAny(candidate.key, " :") || strings.ToLower(candidate.key[:1]) != candidate.key[:1] {
			t.Errorf("%q would be read as a sentence, not a key", candidate.key)
		}
	}
}

func TestPresentSwapsAKnownFailureForItsKey(t *testing.T) {
	// Wrapped, because that is how it arrives: Download adds the blocker.
	err := fmt.Errorf("%w (%s)", ErrNotInstallable, BlockerPackageManager)
	shown := present(err)
	if shown.Error() != "update.error.notInstallable" {
		t.Errorf("present() = %q, want the key", shown.Error())
	}
	// The original has to stay reachable, or a caller can no longer tell one
	// kind of failure from another.
	if !errors.Is(shown, ErrNotInstallable) {
		t.Error("present() lost the failure it describes")
	}
}

func TestPresentLeavesAnUncharacterisedFailureAlone(t *testing.T) {
	err := errors.New("no mirror could be reached (r2: 503; github: timeout)")
	if shown := present(err); shown.Error() != err.Error() {
		t.Errorf("present() = %q, want the message unchanged", shown.Error())
	}
}

func TestPresentIsIdempotent(t *testing.T) {
	once := present(ErrElevationDeclined)
	if twice := present(once); twice.Error() != once.Error() {
		t.Errorf("present(present(err)) = %q, want %q", twice.Error(), once.Error())
	}
}
