package rocketmq

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// The message model only ever arrives from a connected client, so an answer
// that is missing or unrecognised must not be reported as clustering.
func TestConsumeModeFrom(t *testing.T) {
	cases := map[string]model.ConsumeMode{
		"CLUSTERING":   model.ModeClustering,
		"BROADCASTING": model.ModeBroadcasting,
		"broadcasting": model.ModeBroadcasting,
		" CLUSTERING ": model.ModeClustering,
		"":             model.ModeUnknown,
		"PUSH":         model.ModeUnknown,
	}
	for reported, want := range cases {
		if got := consumeModeFrom(reported); got != want {
			t.Fatalf("consumeModeFrom(%q) = %q, want %q", reported, got, want)
		}
	}
}
