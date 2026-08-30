package rabbitmq

import (
	"context"
	"fmt"
	"net/url"

	"github.com/amigoer/mq-studio/internal/model"
)

// Publishing still goes over the management API. It moves to AMQP with the
// send console, where publisher confirms and the full property set are what
// the page needs; browsing has already moved, in message_browse.go.

type publishRequest struct {
	Properties      map[string]any `json:"properties"`
	RoutingKey      string         `json:"routing_key"`
	Payload         string         `json:"payload"`
	PayloadEncoding string         `json:"payload_encoding"`
}

// Routed is the broker saying whether anything was bound to take the message.
// It is not a delivery confirmation, which is one reason the send console
// moves to AMQP.
type publishResponse struct {
	Routed bool `json:"routed"`
}

// MessageByID is not offered: RabbitMQ assigns no stable identifier a message
// could be fetched back by. The capability is not declared, so nothing calls
// this.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	return nil, fmt.Errorf("rabbitmq messages have no stable id to look up")
}

// SendMessage publishes through the default exchange, so the routing key is
// the queue name and the message lands where the publish form points.
func (c *Conn) SendMessage(ctx context.Context, topic, tags, keys, body string, delayLevel int) (string, error) {
	properties := map[string]any{}
	if keys != "" {
		properties["message_id"] = keys
	}
	if tags != "" {
		properties["type"] = tags
	}

	request := publishRequest{
		Properties:      properties,
		RoutingKey:      topic,
		Payload:         body,
		PayloadEncoding: "string",
	}

	var result publishResponse
	// The empty exchange name is the default exchange, which routes by queue
	// name. Publishing to a named exchange is the routing page's job.
	path := fmt.Sprintf("/api/exchanges/%s/%s/publish", url.PathEscape(c.vhost), url.PathEscape("amq.default"))
	if err := c.mgmt.postJSON(ctx, path, request, &result); err != nil {
		return "", fmt.Errorf("publish to %q: %w", topic, err)
	}
	if !result.Routed {
		return "", fmt.Errorf("published, but nothing is bound to route it to %q", topic)
	}
	return topic, nil
}
