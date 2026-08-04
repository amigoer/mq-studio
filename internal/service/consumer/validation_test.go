package consumer

import (
	"testing"

	"github.com/amigoer/rocket-leaf/internal/model"
)

func TestValidateConsumerGroupInput(t *testing.T) {
	_, _, _, _, err := validateConsumerGroupInput("", "127.0.0.1:10911", string(model.ModeClustering), 16)
	if err == nil {
		t.Fatal("empty group name should fail")
	}
	_, _, _, _, err = validateConsumerGroupInput("g1", "b1", "invalid", 1)
	if err == nil {
		t.Fatal("invalid consume mode should fail")
	}
	_, _, _, _, err = validateConsumerGroupInput("g1", "b1", string(model.ModeBroadcasting), 100)
	if err == nil {
		t.Fatal("excessive retry count should fail")
	}

	group, broker, mode, retry, err := validateConsumerGroupInput(
		"  g1  ",
		"  b1  ",
		string(model.ModeClustering),
		16,
	)
	if err != nil || group != "g1" || broker != "b1" || mode != string(model.ModeClustering) || retry != 16 {
		t.Fatalf("valid input was not normalized: %v %q %q %q %d", err, group, broker, mode, retry)
	}
}
