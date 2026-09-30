package mcpserver

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offeredTools is the operations an allowance reaches, keyed as tools is.
func offeredTools(allow catalog.Blast) map[string]string {
	offered := make(map[string]string, len(tools))
	for operationID, info := range tools {
		if _, ok := offer(operationID, allow); ok {
			offered[operationID] = info.name
		}
	}
	return offered
}

/*
 * effect is what a write says it did.
 *
 * Every tool above read returns one, and it is not decoration. A caller that
 * has just published to the wrong destination, or emptied a topic whose
 * offsets keep counting, has no other way to find out: the call succeeded, and
 * success is the same word either way. Changed says what moved in this
 * family's terms; Caveat is what survives the success, taken from the
 * connection rather than written here.
 */
type effect struct {
	Changed string `json:"changed"`
	Caveat  string `json:"caveat,omitempty"`
}

type createDestinationInput struct {
	Connection int               `json:"connection" jsonschema:"the connection id"`
	Name       string            `json:"name" jsonschema:"the destination name"`
	Namespace  string            `json:"namespace,omitempty" jsonschema:"the namespace to create it in, for a family that has them"`
	Partitions int               `json:"partitions,omitempty" jsonschema:"how many partitions or shards, for a family divided into them"`
	Attributes map[string]string `json:"attributes,omitempty" jsonschema:"the family settings, as capabilities_describe lists them for this connection"`
}

func (input createDestinationInput) target() int { return input.Connection }

type writeOutput struct {
	Effect effect `json:"effect"`
	// Reference is whatever the broker returned to name what was written - a
	// message id, usually. Empty where the operation returns nothing.
	Reference string `json:"reference,omitempty"`
}

func (s *server) createDestination(
	ctx context.Context, _ *mcp.CallToolRequest, input createDestinationInput,
) (*mcp.CallToolResult, writeOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapDestinationCreate)
	if err != nil {
		return nil, writeOutput{}, err
	}
	if err := s.checkAttributes(conn.Kind(), "destination.create", input.Attributes); err != nil {
		return nil, writeOutput{}, err
	}

	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	spec := model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: input.Namespace, Name: input.Name},
		Partitions: input.Partitions,
		Attributes: input.Attributes,
	}
	if err := s.services.Topics.Create(ctx, input.Connection, spec); err != nil {
		return nil, writeOutput{}, err
	}
	changed := fmt.Sprintf("created %s on %s", describeRef(spec.Ref), conn.Kind())
	// Checked after, since nothing exists to check before; the effect is the
	// one place a caller would otherwise read that it landed where it asked.
	if err := s.resolvedIn(ctx, input.Connection, conn.Kind(), spec.Ref); err != nil {
		changed = fmt.Sprintf("created %s on %s, but %v", input.Name, conn.Kind(), err)
	}
	return nil, writeOutput{Effect: effect{Changed: changed, Caveat: caveat}}, nil
}

/*
 * checkAttributes refuses a key this family does not read.
 *
 * The driver would ignore it in silence, which is the failure worth designing
 * out: a caller that asked for a quorum queue and got a classic one has no
 * way to tell, because the call succeeded and the setting was simply dropped
 * on the floor. The catalogue knows which keys each family reads, so the
 * refusal can name the ones that would have worked.
 */
func (s *server) checkAttributes(kind model.MQKind, operationID string, given map[string]string) error {
	if len(given) == 0 {
		return nil
	}
	declared := catalog.Attributes(kind, operationID)
	known := make(map[string]bool, len(declared))
	names := make([]string, 0, len(declared))
	for _, attribute := range declared {
		known[attribute.Key] = true
		names = append(names, attribute.Key)
	}
	for key := range given {
		if !known[key] {
			if len(names) == 0 {
				return fmt.Errorf(
					"%s takes no settings on %s, and %q would have been ignored",
					kind, operationID, key)
			}
			return fmt.Errorf(
				"%s does not read %q on %s and would have ignored it; it takes %v",
				kind, key, operationID, names)
		}
	}
	return nil
}

// describeRef quotes the namespace rather than joining it on: RabbitMQ's
// default vhost is "/", which joined reads as a path gone wrong.
func describeRef(ref model.DestinationRef) string {
	if ref.Namespace == "" {
		return ref.Name
	}
	return fmt.Sprintf("%s in %q", ref.Name, ref.Namespace)
}

type publishInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Destination string `json:"destination" jsonschema:"the destination to publish to"`
	Body        string `json:"body" jsonschema:"the message payload"`
	Tags        string `json:"tags,omitempty" jsonschema:"the family's subscription tag, where it has one"`
	Keys        string `json:"keys,omitempty" jsonschema:"the family's message keys, where it has them"`
}

func (input publishInput) target() int { return input.Connection }

// logged keeps the body out of the audit log: its size and digest identify it
// without storing somebody's payload in a second place.
func (input publishInput) logged() any {
	return struct {
		Connection  int    `json:"connection"`
		Destination string `json:"destination"`
		Tags        string `json:"tags,omitempty"`
		Keys        string `json:"keys,omitempty"`
		BodyBytes   int    `json:"bodyBytes"`
		BodySHA256  string `json:"bodySha256"`
	}{input.Connection, input.Destination, input.Tags, input.Keys, len(input.Body), digest(input.Body)}
}

func (s *server) publishMessage(
	ctx context.Context, _ *mcp.CallToolRequest, input publishInput,
) (*mcp.CallToolResult, writeOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapPublish)
	if err != nil {
		return nil, writeOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	// Delay level is left at zero here. It is gated on its own capability, and
	// a field that silently did nothing on a family without it would be the
	// same silence checkAttributes exists to refuse.
	reference, err := s.services.Messages.Send(
		ctx, input.Connection, input.Destination, input.Tags, input.Keys, input.Body, 0)
	if err != nil {
		return nil, writeOutput{}, err
	}
	return nil, writeOutput{
		Effect: effect{
			Changed: fmt.Sprintf("published one message to %s; whatever consumes it has now run",
				input.Destination),
			Caveat: caveat,
		},
		Reference: reference,
	}, nil
}

type resendInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Group       string `json:"group" jsonschema:"the consumer group to resend for"`
	Destination string `json:"destination" jsonschema:"the destination the message came from"`
	MessageID   string `json:"messageId" jsonschema:"the message id, as messages_browse reports it"`
	ClientID    string `json:"clientId,omitempty" jsonschema:"the client the broker attributes the resend to"`
}

func (input resendInput) target() int { return input.Connection }

func (s *server) resendMessage(
	ctx context.Context, _ *mcp.CallToolRequest, input resendInput,
) (*mcp.CallToolResult, writeOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapMessageResend)
	if err != nil {
		return nil, writeOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	reference, err := s.services.Messages.Resend(
		ctx, input.Connection, input.Group, input.ClientID, input.Destination, input.MessageID)
	if err != nil {
		return nil, writeOutput{}, err
	}
	return nil, writeOutput{
		Effect: effect{
			Changed: fmt.Sprintf("put %s back on %s's retry path; the next member to pick it up runs it again",
				input.MessageID, input.Group),
			Caveat: caveat,
		},
		Reference: reference,
	}, nil
}

type resetOffsetInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Group       string `json:"group" jsonschema:"the subscription to move"`
	Destination string `json:"destination" jsonschema:"the destination whose position moves"`
	Timestamp   int64  `json:"timestamp" jsonschema:"the moment to move to, in milliseconds since the epoch"`
	Force       bool   `json:"force,omitempty" jsonschema:"move it even while consumers are attached"`
}

func (input resetOffsetInput) target() int { return input.Connection }

func (s *server) resetOffset(
	ctx context.Context, _ *mcp.CallToolRequest, input resetOffsetInput,
) (*mcp.CallToolResult, writeOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapOffsetReset)
	if err != nil {
		return nil, writeOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if err := s.services.Consumers.ResetOffset(ctx, input.Connection, model.ResetOffsetRequest{
		Group:     input.Group,
		Topic:     input.Destination,
		Timestamp: input.Timestamp,
		Force:     input.Force,
	}); err != nil {
		return nil, writeOutput{}, err
	}
	return nil, writeOutput{Effect: effect{
		Changed: fmt.Sprintf(
			"moved %s's position on %s to the broker's answer for that moment; "+
				"messages either side of it are skipped or redelivered, and none are deleted",
			input.Group, input.Destination),
		Caveat: caveat,
	}}, nil
}

type destinationTargetInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Name       string `json:"name" jsonschema:"the destination name"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the namespace holding it, for a family that has them"`
}

func (input destinationTargetInput) target() int { return input.Connection }

/*
 * purgeDestination goes to the port rather than to a service method.
 *
 * There is no family-neutral one to call: three families expose a purge on
 * their own service and Kafka's is called TruncateTopic, because on a log it
 * is a different act. The catalogue already names the port every family
 * implements for this capability, so going there directly is the thing that
 * does not need a list of families to keep in step.
 */
func (s *server) purgeDestination(
	ctx context.Context, _ *mcp.CallToolRequest, input destinationTargetInput,
) (*mcp.CallToolResult, writeOutput, error) {
	actions, caveat, err := port[driver.QueueActions](s, input.Connection, model.CapDestinationPurge)
	if err != nil {
		return nil, writeOutput{}, err
	}
	conn, _ := s.conn(input.Connection)

	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	ref := model.DestinationRef{Namespace: input.Namespace, Name: input.Name}
	if err := s.resolvedIn(ctx, input.Connection, conn.Kind(), ref); err != nil {
		return nil, writeOutput{}, err
	}
	if err := actions.PurgeQueue(ctx, ref); err != nil {
		return nil, writeOutput{}, err
	}
	return nil, writeOutput{Effect: effect{
		Changed: fmt.Sprintf("emptied %s on %s; the destination is still there and what it held is not",
			describeRef(ref), conn.Kind()),
		Caveat: caveat,
	}}, nil
}

func (s *server) deleteDestination(
	ctx context.Context, _ *mcp.CallToolRequest, input destinationTargetInput,
) (*mcp.CallToolResult, writeOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapDestinationDelete)
	if err != nil {
		return nil, writeOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	ref := model.DestinationRef{Namespace: input.Namespace, Name: input.Name}
	if err := s.resolvedIn(ctx, input.Connection, conn.Kind(), ref); err != nil {
		return nil, writeOutput{}, err
	}
	if err := s.services.Topics.Remove(ctx, input.Connection, ref); err != nil {
		return nil, writeOutput{}, err
	}
	return nil, writeOutput{Effect: effect{
		Changed: fmt.Sprintf("deleted %s from %s, with everything it held; producers addressing it now fail",
			describeRef(ref), conn.Kind()),
		Caveat: caveat,
	}}, nil
}

// attributeSummary is one family setting, as capabilities_describe reports it.
type attributeSummary struct {
	Key      string   `json:"key"`
	Type     string   `json:"type"`
	Required bool     `json:"required,omitempty"`
	Values   []string `json:"values,omitempty"`
	Default  string   `json:"default,omitempty"`
	Summary  string   `json:"summary"`
}

// describeAttributes is what this family accepts on an operation. Empty for a
// read, and for a write whose request is the same shape everywhere.
func describeAttributes(kind model.MQKind, operationID string) []attributeSummary {
	declared := catalog.Attributes(kind, operationID)
	if len(declared) == 0 {
		return nil
	}
	summaries := make([]attributeSummary, 0, len(declared))
	for _, attribute := range declared {
		summaries = append(summaries, attributeSummary{
			Key:      attribute.Key,
			Type:     string(attribute.Type),
			Required: attribute.Required,
			Values:   attribute.Values,
			Default:  attribute.Default,
			Summary:  attribute.Summary,
		})
	}
	return summaries
}
