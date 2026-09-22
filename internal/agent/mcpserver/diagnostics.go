package mcpserver

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

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
func port[T any](s *server, connID int, capability model.Capability) (T, string, error) {
	var zero T
	conn, caveat, err := s.capable(connID, capability)
	if err != nil {
		return zero, "", err
	}
	api, ok := conn.(T)
	if !ok {
		return zero, "", fmt.Errorf(
			"%s reports %s through its listing rather than through a call of its own, "+
				"so there is nothing more to read here", conn.Kind(), capability)
	}
	return api, caveat, nil
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

func (s *server) deadLetters(
	ctx context.Context, _ *mcp.CallToolRequest, input deadLetterInput,
) (*mcp.CallToolResult, messagesOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapDLQ)
	if err != nil {
		return nil, messagesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	messages, err := s.services.Messages.DLQ(ctx, input.Connection, input.Group, s.limit(input.MaxResults))
	if err != nil {
		return nil, messagesOutput{}, err
	}
	return nil, messagesOutput{Messages: messages, Caveat: caveat}, nil
}

func (s *server) retryQueue(
	ctx context.Context, _ *mcp.CallToolRequest, input deadLetterInput,
) (*mcp.CallToolResult, messagesOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapDLQ)
	if err != nil {
		return nil, messagesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	messages, err := s.services.Messages.Retry(ctx, input.Connection, input.Group, s.limit(input.MaxResults))
	if err != nil {
		return nil, messagesOutput{}, err
	}
	return nil, messagesOutput{Messages: messages, Caveat: caveat}, nil
}

// limit falls back to the page size the application itself reads with, so a
// caller that does not care gets the same amount a person would see.
func (s *server) limit(requested int) int {
	if requested > 0 {
		return requested
	}
	return s.services.Messages.FetchLimit()
}

type namespaceInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"narrow to one namespace; empty is the connection's own scope"`
}

type deadLetterQueuesOutput struct {
	Queues []*model.DeadLetterQueue `json:"queues"`
	Caveat string                   `json:"caveat,omitempty"`
}

func (s *server) deadLetterQueues(
	ctx context.Context, _ *mcp.CallToolRequest, input namespaceInput,
) (*mcp.CallToolResult, deadLetterQueuesOutput, error) {
	api, caveat, err := port[driver.DeadLetterTopology](s, input.Connection, model.CapDeadLetterTopology)
	if err != nil {
		return nil, deadLetterQueuesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	queues, err := api.DeadLetterQueues(ctx, input.Namespace)
	if err != nil {
		return nil, deadLetterQueuesOutput{}, err
	}
	return nil, deadLetterQueuesOutput{Queues: queues, Caveat: caveat}, nil
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
func (s *server) subscriptionLag(
	ctx context.Context, _ *mcp.CallToolRequest, input subscriptionInput,
) (*mcp.CallToolResult, lagOutput, error) {
	api, caveat, err := port[driver.SubscriptionStats](s, input.Connection, model.CapSubscriptionLag)
	if err != nil {
		return nil, lagOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	progress, err := api.SubscriptionStats(ctx, input.ref())
	if err != nil {
		return nil, lagOutput{}, err
	}
	return nil, lagOutput{Progress: progress, Caveat: caveat}, nil
}

type subscriptionClientsOutput struct {
	Clients []*model.SubscriptionClient `json:"clients"`
	Caveat  string                      `json:"caveat,omitempty"`
}

func (s *server) subscriptionConsumers(
	ctx context.Context, _ *mcp.CallToolRequest, input subscriptionInput,
) (*mcp.CallToolResult, subscriptionClientsOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapSubscriptionRuntime)
	if err != nil {
		return nil, subscriptionClientsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	clients, err := s.services.Consumers.Clients(ctx, input.Connection, input.ref())
	if err != nil {
		return nil, subscriptionClientsOutput{}, err
	}
	return nil, subscriptionClientsOutput{Clients: clients, Caveat: caveat}, nil
}

type pendingSummaryOutput struct {
	Summary *model.PendingSummary `json:"summary"`
	Caveat  string                `json:"caveat,omitempty"`
}

func (s *server) pendingSummary(
	ctx context.Context, _ *mcp.CallToolRequest, input subscriptionInput,
) (*mcp.CallToolResult, pendingSummaryOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](s, input.Connection, model.CapPendingEntries)
	if err != nil {
		return nil, pendingSummaryOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	summary, err := api.PendingSummary(ctx, input.ref())
	if err != nil {
		return nil, pendingSummaryOutput{}, err
	}
	return nil, pendingSummaryOutput{Summary: summary, Caveat: caveat}, nil
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

func (s *server) pendingEntries(
	ctx context.Context, _ *mcp.CallToolRequest, input pendingEntriesInput,
) (*mcp.CallToolResult, pendingEntriesOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](s, input.Connection, model.CapPendingEntries)
	if err != nil {
		return nil, pendingEntriesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	entries, err := api.PendingEntries(ctx, model.PendingQuery{
		Ref:       model.SubscriptionRef{Namespace: input.Namespace, Name: input.Group},
		Consumer:  input.Consumer,
		MinIdleMs: input.MinIdleMs,
		Count:     input.Count,
	})
	if err != nil {
		return nil, pendingEntriesOutput{}, err
	}
	return nil, pendingEntriesOutput{Entries: entries, Caveat: caveat}, nil
}

type groupConsumersOutput struct {
	Consumers []*model.GroupConsumer `json:"consumers"`
	Caveat    string                 `json:"caveat,omitempty"`
}

func (s *server) groupConsumers(
	ctx context.Context, _ *mcp.CallToolRequest, input subscriptionInput,
) (*mcp.CallToolResult, groupConsumersOutput, error) {
	api, caveat, err := port[driver.PendingEntryReader](s, input.Connection, model.CapPendingEntries)
	if err != nil {
		return nil, groupConsumersOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	consumers, err := api.GroupConsumers(ctx, input.ref())
	if err != nil {
		return nil, groupConsumersOutput{}, err
	}
	return nil, groupConsumersOutput{Consumers: consumers, Caveat: caveat}, nil
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

func (s *server) messageByID(
	ctx context.Context, _ *mcp.CallToolRequest, input messageByIDInput,
) (*mcp.CallToolResult, messageOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapMessageByID)
	if err != nil {
		return nil, messageOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	message, err := s.services.Messages.ByID(ctx, input.Connection, input.Destination, input.MessageID)
	if err != nil {
		return nil, messageOutput{}, err
	}
	// An empty answer is a finding, and has to read as one rather than as a
	// successful call that happened to carry nothing.
	if message == nil {
		return nil, messageOutput{}, fmt.Errorf(
			"%s holds no message %q in %s", conn.Kind(), input.MessageID, input.Destination)
	}
	return nil, messageOutput{Message: message, Caveat: caveat}, nil
}
