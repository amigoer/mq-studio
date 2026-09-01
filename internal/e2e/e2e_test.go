package e2e

import (
	"errors"
	"testing"
)

// The whole policy as a table. The first row is the regression this package
// exists for: in CI, with nobody having set the opt-in, the suite runs.
func TestDecide(t *testing.T) {
	absent := errors.New("nothing listening")
	up := func() error { return nil }
	down := func() error { return absent }

	for _, test := range []struct {
		name  string
		ci    bool
		optIn string
		probe func() error
		want  verdict
	}{
		{"CI does not consult the opt-in", true, "", up, run},
		{"CI fails rather than skips when the environment is absent", true, "", down, failAbsent},
		{"CI runs with the opt-in set as well", true, "1", up, run},
		{"locally the opt-in is what asks for the live suites", false, "", up, skipOptOut},
		{"locally an absent environment is a skip", false, "1", down, skipAbsent},
		{"locally the opt-in and a live environment run", false, "1", up, run},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := decide(test.ci, test.optIn, test.probe)
			if got != test.want {
				t.Fatalf("decide = %d, want %d", got, test.want)
			}
			if (err != nil) != (test.want == skipAbsent || test.want == failAbsent) {
				t.Fatalf("decide returned err %v with verdict %d", err, got)
			}
		})
	}
}

// Opting out must not dial anything: it is what keeps `go test ./...` quick on
// a checkout with the brokers running.
func TestDecideDoesNotProbeWhenOptedOut(t *testing.T) {
	probed := 0
	probe := func() error { probed++; return nil }

	if _, _ = decide(false, "", probe); probed != 0 {
		t.Fatalf("probed %d times while opted out", probed)
	}
	if _, _ = decide(true, "", probe); probed != 1 {
		t.Fatalf("probed %d times in CI, want 1", probed)
	}
}
