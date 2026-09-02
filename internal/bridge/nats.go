package bridge

import (
	"context"
	"strconv"

	natsdriver "github.com/amigoer/mq-studio/internal/driver/nats"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/nats"
)

// NATSService exposes what only NATS has.
//
// It is one service rather than several because it is one family's surface,
// the same reason MQTTService and KafkaService are one each.
//
// Reading streams is not here. A stream is a destination and TopicService
// already answers the whole read side; a second read path would be two sources
// for one number. What is here is the writing, which the canonical service
// cannot express: its create collects a broker address, a read queue, a write
// queue and a permission mask, and a JetStream stream has none of those.
type NATSService struct {
	service *nats.Service
}

// StreamInput is a stream as the dialog collects it.
//
// Deliberately not TopicService.Create's shape. Every field there is
// RocketMQ's vocabulary and none of it has a JetStream meaning, and there is
// nowhere in it to put a subject list, a retention policy, or a limit - which
// is most of what declaring a stream is.
//
// The limits are strings rather than numbers so that "not set" and "set to
// zero" stay different. -1 is how the server spells no limit, 0 means a stream
// that can hold nothing, and a numeric field that arrived empty would have to
// pick one of those for the user.
type StreamInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Subjects is the list the stream captures, however the form separated it.
	// A mirror has none.
	Subjects string `json:"subjects"`
	// Retention is limits, interest or workqueue. Work queue is the one where
	// reading the stream changes what it holds.
	Retention string `json:"retention"`
	Storage   string `json:"storage"`
	Discard   string `json:"discard"`
	Replicas  int    `json:"replicas"`

	MaxMsgs           string `json:"maxMsgs"`
	MaxBytes          string `json:"maxBytes"`
	MaxMsgsPerSubject string `json:"maxMsgsPerSubject"`
	MaxMsgSize        string `json:"maxMsgSize"`
	// MaxAge and DuplicateWindow are Go durations - "24h", "2m" - because that
	// is what the server reports and what an operator writes.
	MaxAge          string `json:"maxAge"`
	DuplicateWindow string `json:"duplicateWindow"`

	Compression string `json:"compression"`
	DenyDelete  bool   `json:"denyDelete"`
	DenyPurge   bool   `json:"denyPurge"`
	AllowRollup bool   `json:"allowRollup"`
}

func (input StreamInput) spec() model.DestinationSpec {
	attributes := map[string]string{
		natsdriver.AttrSubjects:    input.Subjects,
		natsdriver.AttrDescription: input.Description,
		natsdriver.AttrRetention:   input.Retention,
		natsdriver.AttrStorage:     input.Storage,
		natsdriver.AttrDiscard:     input.Discard,
		natsdriver.AttrMaxMsgs:     input.MaxMsgs,
		natsdriver.AttrMaxBytes:    input.MaxBytes,
		natsdriver.AttrMaxMsgsPer:  input.MaxMsgsPerSubject,
		natsdriver.AttrMaxMsgSize:  input.MaxMsgSize,
		natsdriver.AttrMaxAge:      input.MaxAge,
		natsdriver.AttrDuplicates:  input.DuplicateWindow,
		natsdriver.AttrCompression: input.Compression,
	}
	// Written only when true, because the driver reads a missing attribute as
	// false and writing "false" for every unset switch would fill the map with
	// noise that means nothing.
	if input.DenyDelete {
		attributes[natsdriver.AttrDenyDelete] = "true"
	}
	if input.DenyPurge {
		attributes[natsdriver.AttrDenyPurge] = "true"
	}
	if input.AllowRollup {
		attributes[natsdriver.AttrAllowRollup] = "true"
	}
	if input.Replicas > 0 {
		attributes[natsdriver.AttrReplicas] = strconv.Itoa(input.Replicas)
	}

	return model.DestinationSpec{
		Ref:        model.DestinationRef{Name: input.Name},
		Attributes: attributes,
	}
}

// CreateStream declares a stream that does not exist yet.
//
// Separate from UpdateStream rather than one idempotent call, because the two
// mistakes they prevent are different: a create that quietly became an update
// would rewrite another application's subjects, and an update that quietly
// became a create would hide a stream somebody had deleted underneath the
// page.
func (s *NATSService) CreateStream(connID int, input StreamInput) error {
	return s.service.SaveStream(context.Background(), connID, input.spec(), false)
}

// UpdateStream rewrites an existing stream's configuration.
//
// Some fields cannot change - storage, and the retention policy of a stream
// that already holds messages. The server refuses those itself and says which,
// which is why nothing here pre-empts it: a rule copied into the client is a
// rule that goes stale a release later.
func (s *NATSService) UpdateStream(connID int, input StreamInput) error {
	return s.service.SaveStream(context.Background(), connID, input.spec(), true)
}

// DeleteStream removes a stream and every message in it.
func (s *NATSService) DeleteStream(connID int, name string) error {
	return s.service.DeleteStream(context.Background(), connID, name)
}
