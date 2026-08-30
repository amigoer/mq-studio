package rabbitmq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// rabbit-hole does not wrap the message endpoints, so these two go over plain
// HTTP. The management API is REST either way; nothing is lost but the typed
// wrapper.

// ackModeBrowse requeues what it reads instead of consuming it.
//
// It is the closest RabbitMQ offers to browsing, and it is still not a read.
// The broker's own documentation says so: the endpoint is a POST because it
// alters queue state. A requeued message keeps its position but comes back
// flagged redelivered, and anything consuming concurrently sees the gap.
const ackModeBrowse = "reject_requeue_true"

type getMessagesRequest struct {
	Count    int    `json:"count"`
	AckMode  string `json:"ackmode"`
	Encoding string `json:"encoding"`
	Truncate int    `json:"truncate"`
}

type getMessagesResponse struct {
	PayloadBytes int    `json:"payload_bytes"`
	Redelivered  bool   `json:"redelivered"`
	Exchange     string `json:"exchange"`
	RoutingKey   string `json:"routing_key"`
	MessageCount int    `json:"message_count"`
	Payload      string `json:"payload"`
	// A message with no properties comes back as [] rather than {}. Erlang
	// encodes an empty map as an empty list, so decoding straight into a map
	// fails on exactly the common case.
	Properties messageProperties `json:"properties"`
}

// messageProperties decodes either shape the broker sends.
type messageProperties map[string]any

func (p *messageProperties) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] == '[' || string(trimmed) == "null" {
		*p = messageProperties{}
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return err
	}
	*p = decoded
	return nil
}

type publishRequest struct {
	Properties      map[string]any `json:"properties"`
	RoutingKey      string         `json:"routing_key"`
	Payload         string         `json:"payload"`
	PayloadEncoding string         `json:"payload_encoding"`
}

type publishResponse struct {
	Routed bool `json:"routed"`
}

// maxBrowseBytes caps a payload so one oversized message cannot stall the page.
const maxBrowseBytes = 50000

// QueryMessages browses a queue.
//
// Everything the canonical params carry beyond the destination is ignored,
// because there is nothing to honour: no message id to look up, no key index,
// no time range. What comes back is the head of the queue.
func (c *Conn) QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	count := params.MaxResults
	if count <= 0 {
		count = 32
	}
	body := getMessagesRequest{
		Count:    count,
		AckMode:  ackModeBrowse,
		Encoding: "auto",
		Truncate: maxBrowseBytes,
	}

	var fetched []getMessagesResponse
	path := fmt.Sprintf("/api/queues/%s/%s/get", url.PathEscape(c.vhost), url.PathEscape(params.Topic))
	if err := c.post(ctx, path, body, &fetched); err != nil {
		return nil, fmt.Errorf("browse queue %q: %w", params.Topic, err)
	}

	items := make([]*model.MessageItem, 0, len(fetched))
	for i := range fetched {
		items = append(items, messageFromGet(params.Topic, &fetched[i]))
	}
	return items, nil
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
	if err := c.post(ctx, path, request, &result); err != nil {
		return "", fmt.Errorf("publish to %q: %w", topic, err)
	}
	if !result.Routed {
		return "", fmt.Errorf("published, but nothing is bound to route it to %q", topic)
	}
	return topic, nil
}

func messageFromGet(queue string, source *getMessagesResponse) *model.MessageItem {
	properties := make(map[string]string, len(source.Properties))
	for key, value := range source.Properties {
		properties[key] = fmt.Sprint(value)
	}
	properties["redelivered"] = strconv.FormatBool(source.Redelivered)
	if source.Exchange != "" {
		properties["exchange"] = source.Exchange
	}

	messageID := ""
	if raw, ok := source.Properties["message_id"]; ok {
		messageID = fmt.Sprint(raw)
	}

	return &model.MessageItem{
		Topic: queue,
		// There is no broker-assigned id. The message's own message_id
		// property is the only candidate and applications often leave it
		// unset, so an absent one stays absent rather than being invented.
		MessageID:      messageID,
		Keys:           source.RoutingKey,
		Body:           source.Payload,
		Status:         model.MsgNormal,
		StoreTime:      timestamp.Now(),
		StoreTimestamp: time.Now().UnixMilli(),
		QueueID:        model.UnknownMetric,
		QueueOffset:    model.UnknownMetric,
		Properties:     properties,
	}
}

// post sends one management API request.
func (c *Conn) post(ctx context.Context, path string, body, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.endpoint+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.SetBasicAuth(c.username, c.password)
	request.Header.Set("Content-Type", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("management API returned %s", response.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(out)
}
