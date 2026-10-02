package toolset

import (
	"context"
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The two questions an inventory cannot answer.
 *
 * Listing destinations and subscriptions says what exists and roughly how far
 * behind it is. Neither says why something is behind, or where a message that
 * never arrived went - and those are the two things somebody actually opens
 * this application to find out.
 *
 * Three families answer the second question three different ways, which is why
 * there are three tools for it rather than one: a dead letter is a per-group
 * topic on RocketMQ, a queue something else routes into on RabbitMQ, and on
 * Redis nothing is moved at all - there is a delivery record per unacknowledged
 * entry instead. Collapsing those into one tool would mean inventing an answer
 * for whichever family was not asked.
 */

// port resolves a capability and the interface behind it in one step, for an
// operation the application has no family-neutral service method for.
func port[T any](e *Env, connID int, capability model.Capability) (T, string, error) {
	api, _, caveat, err := portOf[T](e, connID, capability)
	return api, caveat, err
}

// portOf is port for a caller that also needs the family - to check what came
// back against the namespace it asked for.
func portOf[T any](e *Env, connID int, capability model.Capability) (T, model.MQKind, string, error) {
	var zero T
	conn, caveat, err := e.capable(connID, capability)
	if err != nil {
		return zero, "", "", err
	}
	api, ok := conn.(T)
	if !ok {
		return zero, "", "", fmt.Errorf(
			"%s reports %s through its listing rather than through a call of its own, "+
				"so there is nothing more to read here", conn.Kind(), capability)
	}
	return api, conn.Kind(), caveat, nil
}

type deadLetterInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Group      string `json:"group" jsonschema:"the consumer group or subscription whose backlog to read"`
	MaxResults int    `json:"maxResults,omitempty" jsonschema:"how many to return at most; the application's own page size when omitted"`
}

type messagesOutput struct {
	Messages []*model.MessageItem `json:"messages"`
	Caveat   string               `json:"caveat,omitempty"`
}

func (e *Env) deadLetters(ctx context.Context, input deadLetterInput) (messagesOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapDLQ)
	if err != nil {
		return messagesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	messages, err := e.Services.Messages.DLQ(ctx, input.Connection, input.Group, e.limit(input.MaxResults))
	if err != nil {
		return messagesOutput{}, err
	}
	return messagesOutput{Messages: messages, Caveat: caveat}, nil
}

func (e *Env) retryQueue(ctx context.Context, input deadLetterInput) (messagesOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapDLQ)
	if err != nil {
		return messagesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	messages, err := e.Services.Messages.Retry(ctx, input.Connection, input.Group, e.limit(input.MaxResults))
	if err != nil {
		return messagesOutput{}, err
	}
	return messagesOutput{Messages: messages, Caveat: caveat}, nil
}

type namespaceInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"narrow to one namespace; empty is the connection's own scope"`
}

type deadLetterQueuesOutput struct {
	Queues []*model.DeadLetterQueue `json:"queues"`
	Caveat string                   `json:"caveat,omitempty"`
}

func (e *Env) deadLetterQueues(ctx context.Context, input namespaceInput) (deadLetterQueuesOutput, error) {
	api, caveat, err := port[driver.DeadLetterTopology](e, input.Connection, model.CapDeadLetterTopology)
	if err != nil {
		return deadLetterQueuesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	queues, err := api.DeadLetterQueues(ctx, input.Namespace)
	if err != nil {
		return deadLetterQueuesOutput{}, err
	}
	return deadLetterQueuesOutput{Queues: queues, Caveat: caveat}, nil
}

type subscriptionInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Group      string `json:"group" jsonschema:"the consumer group or subscription name"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the namespace or topic it belongs to, for a family that scopes subscriptions"`
}

func (input subscriptionInput) ref() model.SubscriptionRef {
	return model.SubscriptionRef{Namespace: input.Namespace, Name: input.Group}
}

type lagOutput struct {
	// Progress is the family's own shape, passed through. What a partition is
	// called and what a broker reports beside the offsets differs enough that
	// normalising it here would be inventing a figure.
	Progress map[string]any `json:"progress"`
	Caveat   string         `json:"caveat,omitempty"`
}

/*
 * subscriptionLag goes through the port rather than the capability alone.
 *
 * Twelve families declare CapSubscriptionLag and three implement the interface
 * this reads: for the other nine the backlog arrives with the subscription
 * listing and there is no per-partition call to make. The capability check
 * would pass on all twelve, so the port is what separates "ask the listing"
 * from "there is more detail here".
 */
func (e *Env) subscriptionLag(ctx context.Context, input subscriptionInput) (lagOutput, error) {
	api, caveat, err := port[driver.SubscriptionStats](e, input.Connection, model.CapSubscriptionLag)
	if err != nil {
		return lagOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	progress, err := api.SubscriptionStats(ctx, input.ref())
	if err != nil {
		return lagOutput{}, err
	}
	return lagOutput{Progress: progress, Caveat: caveat}, nil
}

type subscriptionClientsOutput struct {
	Clients []*model.SubscriptionClient `json:"clients"`
	Caveat  string                      `json:"caveat,omitempty"`
}

func (e *Env) subscriptionConsumers(ctx context.Context, input subscriptionInput) (subscriptionClientsOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapSubscriptionRuntime)
	if err != nil {
		return subscriptionClientsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	clients, err := e.Services.Consumers.Clients(ctx, input.Connection, input.ref())
	if err != nil {
		return subscriptionClientsOutput{}, err
	}
	return subscriptionClientsOutput{Clients: clients, Caveat: caveat}, nil
}

type pendingSummaryOutput struct {
	Summary *model.PendingSummary `json:"summary"`
	Caveat  string                `json:"caveat,omitempty"`
}

func (e *Env) pendingSummary(ctx context.Context, input subscriptionInput) (pendingSummaryOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](e, input.Connection, model.CapPendingEntries)
	if err != nil {
		return pendingSummaryOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	summary, err := api.PendingSummary(ctx, input.ref())
	if err != nil {
		return pendingSummaryOutput{}, err
	}
	return pendingSummaryOutput{Summary: summary, Caveat: caveat}, nil
}

type pendingEntriesInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Group      string `json:"group" jsonschema:"the consumer group whose pending list to walk"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the stream the group reads, for a family that scopes subscriptions"`
	Consumer   string `json:"consumer,omitempty" jsonschema:"narrow to one consumer's share; empty is all of them"`
	MinIdleMs  int64  `json:"minIdleMs,omitempty" jsonschema:"only entries untouched for at least this long, which is how the ones worth acting on are found"`
	Count      int    `json:"count,omitempty" jsonschema:"how many entries to return at most"`
}

type pendingEntriesOutput struct {
	Entries []*model.PendingEntry `json:"entries"`
	Caveat  string                `json:"caveat,omitempty"`
}

func (e *Env) pendingEntries(ctx context.Context, input pendingEntriesInput) (pendingEntriesOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](e, input.Connection, model.CapPendingEntries)
	if err != nil {
		return pendingEntriesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	entries, err := api.PendingEntries(ctx, model.PendingQuery{
		Ref:       model.SubscriptionRef{Namespace: input.Namespace, Name: input.Group},
		Consumer:  input.Consumer,
		MinIdleMs: input.MinIdleMs,
		Count:     input.Count,
	})
	if err != nil {
		return pendingEntriesOutput{}, err
	}
	return pendingEntriesOutput{Entries: entries, Caveat: caveat}, nil
}

type groupConsumersOutput struct {
	Consumers []*model.GroupConsumer `json:"consumers"`
	Caveat    string                 `json:"caveat,omitempty"`
}

func (e *Env) groupConsumers(ctx context.Context, input subscriptionInput) (groupConsumersOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](e, input.Connection, model.CapPendingEntries)
	if err != nil {
		return groupConsumersOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	consumers, err := api.GroupConsumers(ctx, input.ref())
	if err != nil {
		return groupConsumersOutput{}, err
	}
	return groupConsumersOutput{Consumers: consumers, Caveat: caveat}, nil
}

type messageByIDInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Destination string `json:"destination" jsonschema:"the destination holding it"`
	MessageID   string `json:"messageId" jsonschema:"the message id, as messages_browse reports it"`
}

type messageOutput struct {
	Message *model.MessageItem `json:"message"`
	Caveat  string             `json:"caveat,omitempty"`
}

func (e *Env) messageByID(ctx context.Context, input messageByIDInput) (messageOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapMessageByID)
	if err != nil {
		return messageOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	message, err := e.Services.Messages.ByID(ctx, input.Connection, input.Destination, input.MessageID)
	if err != nil {
		return messageOutput{}, err
	}
	// An empty answer is a finding, and has to read as one rather than as a
	// successful call that happened to carry nothing.
	if message == nil {
		return messageOutput{}, fmt.Errorf(
			"%s holds no message %q in %s", conn.Kind(), input.MessageID, input.Destination)
	}
	return messageOutput{Message: message, Caveat: caveat}, nil
}

type trackInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Destination string `json:"destination" jsonschema:"the destination the message was sent to"`
	MessageID   string `json:"messageId" jsonschema:"the message id, as messages_browse reports it"`
}

type trackOutput struct {
	// Groups is one entry per consumer group subscribed to the destination.
	// None at all is itself the answer: nothing was ever going to consume it.
	Groups []*model.MessageTrackItem `json:"groups"`
	Caveat string                    `json:"caveat,omitempty"`
}

func (e *Env) trackMessage(ctx context.Context, input trackInput) (trackOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapMessageTrack)
	if err != nil {
		return trackOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	groups, err := e.Services.Messages.Track(ctx, input.Connection, input.Destination, input.MessageID)
	if err != nil {
		return trackOutput{}, err
	}
	return trackOutput{Groups: groups, Caveat: caveat}, nil
}
