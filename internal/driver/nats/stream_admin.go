package nats

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// CreateDestination declares a stream.
//
// The spec's Partitions field is refused rather than ignored. A stream has no
// partitions - every subject in it shares one sequence and one order - and
// silently dropping a number the caller set would report success for a stream
// that is not what they asked for. What the form collects instead travels in
// Attributes, whose keys are this package's own.
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	config, err := streamConfigOf(spec)
	if err != nil {
		return err
	}
	// CreateStream rather than CreateOrUpdateStream: a create that quietly
	// rewrote an existing stream's subjects would take another application's
	// messages with it.
	if _, err := c.js.CreateStream(ctx, config); err != nil {
		return streamError(spec.Ref.Name, err)
	}
	return nil
}

// UpdateDestination changes a stream's configuration.
//
// Most fields are editable and a few are not - storage, and the retention
// policy on a stream that already holds messages. The server refuses those
// itself and says which, so they are passed through rather than pre-empted
// here: a rule copied into the client is a rule that goes stale.
func (c *Conn) UpdateDestination(ctx context.Context, spec model.DestinationSpec) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	config, err := streamConfigOf(spec)
	if err != nil {
		return err
	}
	if _, err := c.js.UpdateStream(ctx, config); err != nil {
		return streamError(spec.Ref.Name, err)
	}
	return nil
}

// RemoveDestination deletes a stream and everything it holds.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	if err := c.js.DeleteStream(ctx, ref.Name); err != nil {
		return streamError(ref.Name, err)
	}
	return nil
}

// streamConfigOf builds a stream configuration from what the form collected.
//
// Everything is optional except the name and the subjects, and an omitted
// attribute leaves the server's own default rather than sending a zero. The
// difference matters: MaxAge of zero means "no age limit", so a form that
// sent zero for a field the user never touched would be setting a policy
// rather than declining to.
func streamConfigOf(spec model.DestinationSpec) (jetstream.StreamConfig, error) {
	name := strings.TrimSpace(spec.Ref.Name)
	if err := validateStreamName(name); err != nil {
		return jetstream.StreamConfig{}, err
	}
	if spec.Partitions > 0 {
		return jetstream.StreamConfig{}, fmt.Errorf(
			"a jetstream stream has no partitions; every subject in it shares one sequence")
	}

	attributes := spec.Attributes
	if attributes == nil {
		attributes = map[string]string{}
	}

	subjects := splitSubjects(attributes[AttrSubjects])
	// A mirror takes its messages from another stream and is published to
	// through that one, so it is the single case where no subjects is correct
	// rather than a form left blank.
	if len(subjects) == 0 && attributes[AttrMirrorOf] == "" {
		return jetstream.StreamConfig{}, fmt.Errorf("a stream needs at least one subject")
	}
	for _, subject := range subjects {
		if err := validateSubject(subject); err != nil {
			return jetstream.StreamConfig{}, err
		}
	}

	config := jetstream.StreamConfig{
		Name:        name,
		Description: attributes[AttrDescription],
		Subjects:    subjects,
		Retention:   retentionPolicy(attributes[AttrRetention]),
		Storage:     storageType(attributes[AttrStorage]),
		Discard:     discardPolicy(attributes[AttrDiscard]),
		Replicas:    intAttr(attributes, AttrReplicas, 1),
		DenyDelete:  boolAttr(attributes, AttrDenyDelete),
		DenyPurge:   boolAttr(attributes, AttrDenyPurge),
		AllowRollup: boolAttr(attributes, AttrAllowRollup),
	}

	// Unlimited is -1 in this API and 0 in nobody's mental model, so a blank
	// field has to become -1 and not fall through as zero - which would be a
	// stream that can hold no messages at all.
	config.MaxMsgs = int64Attr(attributes, AttrMaxMsgs, -1)
	config.MaxBytes = int64Attr(attributes, AttrMaxBytes, -1)
	config.MaxMsgsPerSubject = int64Attr(attributes, AttrMaxMsgsPer, -1)
	config.MaxMsgSize = int32(int64Attr(attributes, AttrMaxMsgSize, -1))

	age, err := durationAttr(attributes, AttrMaxAge)
	if err != nil {
		return jetstream.StreamConfig{}, fmt.Errorf("max age: %w", err)
	}
	config.MaxAge = age

	duplicates, err := durationAttr(attributes, AttrDuplicates)
	if err != nil {
		return jetstream.StreamConfig{}, fmt.Errorf("duplicate window: %w", err)
	}
	config.Duplicates = duplicates

	if attributes[AttrCompression] == "s2" {
		config.Compression = jetstream.S2Compression
	}
	return config, nil
}

// validateStreamName refuses what the server would, with a message that says
// which character is the problem.
//
// The server's own error is "invalid stream name", which on a name pasted from
// a subject - the commonest mistake, because a dot is legal in one and not the
// other - leaves the user staring at something that looks fine.
func validateStreamName(name string) error {
	if name == "" {
		return fmt.Errorf("a stream needs a name")
	}
	for _, forbidden := range []struct {
		char rune
		why  string
	}{
		{'.', "a dot separates subject tokens and cannot appear in a stream name"},
		{'*', "a wildcard belongs in a subject, not in a stream name"},
		{'>', "a wildcard belongs in a subject, not in a stream name"},
		{' ', "a stream name cannot contain spaces"},
		{'\t', "a stream name cannot contain tabs"},
		{'/', "a stream name cannot contain a slash"},
		{'\\', "a stream name cannot contain a backslash"},
	} {
		if strings.ContainsRune(name, forbidden.char) {
			return fmt.Errorf("%q is not a valid stream name: %s", name, forbidden.why)
		}
	}
	return nil
}

// validateSubject refuses the wildcard placements NATS does not allow.
//
// A > matches the rest of a subject and therefore only means anything at the
// end; anywhere else it silently matches nothing, and the stream would sit
// there collecting no messages with nothing to show why.
func validateSubject(subject string) error {
	if subject == "" {
		return fmt.Errorf("a subject cannot be empty")
	}
	// No check for whitespace here, and that is not an omission: splitSubjects
	// treats a space as a separator, so a subject carrying one cannot reach
	// this function. Somebody typing "orders new" has named two subjects,
	// which is what they meant - a NATS subject cannot contain a space at all.
	tokens := strings.Split(subject, ".")
	for index, token := range tokens {
		switch {
		case token == "":
			return fmt.Errorf("%q is not a valid subject: it has an empty token", subject)
		case token == ">" && index != len(tokens)-1:
			return fmt.Errorf("%q is not a valid subject: > matches the rest of a subject and must come last", subject)
		case token != "*" && token != ">" && strings.ContainsAny(token, "*>"):
			return fmt.Errorf("%q is not a valid subject: a wildcard is a whole token, not part of one", subject)
		}
	}
	return nil
}

// splitSubjects takes the list the form collected, however it was separated.
func splitSubjects(raw string) []string {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})
	subjects := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		subject := strings.TrimSpace(field)
		if subject == "" || seen[subject] {
			continue
		}
		seen[subject] = true
		subjects = append(subjects, subject)
	}
	return subjects
}

func retentionPolicy(name string) jetstream.RetentionPolicy {
	switch name {
	case "interest":
		return jetstream.InterestPolicy
	case "workqueue":
		return jetstream.WorkQueuePolicy
	default:
		return jetstream.LimitsPolicy
	}
}

func storageType(name string) jetstream.StorageType {
	if name == "memory" {
		return jetstream.MemoryStorage
	}
	return jetstream.FileStorage
}

func discardPolicy(name string) jetstream.DiscardPolicy {
	if name == "new" {
		return jetstream.DiscardNew
	}
	return jetstream.DiscardOld
}

func intAttr(attributes map[string]string, key string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(attributes[key]))
	if err != nil {
		return fallback
	}
	return parsed
}

func int64Attr(attributes map[string]string, key string, fallback int64) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(attributes[key]), 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

// durationAttr takes what Go's own parser takes - "24h", "10m" - and treats a
// blank as no limit, which is what zero means to the server.
func durationAttr(attributes map[string]string, key string) (time.Duration, error) {
	raw := strings.TrimSpace(attributes[key])
	if raw == "" || raw == "0" || raw == "0s" {
		return 0, nil
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%q is not a duration; write it like 24h or 10m", raw)
	}
	if parsed < 0 {
		return 0, fmt.Errorf("%q is negative; leave it empty for no limit", raw)
	}
	return parsed, nil
}

func boolAttr(attributes map[string]string, key string) bool {
	return strings.TrimSpace(attributes[key]) == "true"
}
