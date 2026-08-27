package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/message"
)

// MessageService exposes message browse and publish to the frontend.
type MessageService struct {
	service *message.Service
}

// MessageQuery carries the message search form.
type MessageQuery struct {
	Topic      string `json:"topic"`
	Key        string `json:"key"`
	Tag        string `json:"tag"`
	MaxResults int    `json:"maxResults"`
	StartTime  int64  `json:"startTime"`
	EndTime    int64  `json:"endTime"`
}

// ResendInput identifies a message to push back to a consumer group.
type ResendInput struct {
	ConsumerGroup string `json:"consumerGroup"`
	ClientID      string `json:"clientId"`
	Topic         string `json:"topic"`
	MessageID     string `json:"messageId"`
}

// SendInput carries a produced message.
type SendInput struct {
	Topic      string `json:"topic"`
	Tags       string `json:"tags"`
	Keys       string `json:"keys"`
	Body       string `json:"body"`
	DelayLevel int    `json:"delayLevel"`
}

// defaultMaxResults mirrors the page size the message views request.
const defaultMaxResults = 32

func maxResultsOrDefault(value int) int {
	if value <= 0 {
		return defaultMaxResults
	}
	return value
}

// Query searches a topic by key, tag and time range.
func (s *MessageService) Query(connID int, query MessageQuery) ([]*model.MessageItem, error) {
	return s.service.Query(context.Background(), connID, model.MessageQueryParams{
		Topic:      query.Topic,
		MessageKey: query.Key,
		StartTime:  query.StartTime,
		EndTime:    query.EndTime,
		MaxResults: maxResultsOrDefault(query.MaxResults),
		Filters:    map[string]string{rocketmq.FilterTag: query.Tag},
	})
}

// ByID returns a single message by its ID.
func (s *MessageService) ByID(connID int, topic string, messageID string) (*model.MessageItem, error) {
	return s.service.ByID(context.Background(), connID, topic, messageID)
}

// Track returns the per-group consume status of a message.
func (s *MessageService) Track(connID int, topic string, messageID string) ([]*model.MessageTrackItem, error) {
	return s.service.Track(context.Background(), connID, topic, messageID)
}

// DLQ returns the dead letter messages of a consumer group.
func (s *MessageService) DLQ(connID int, group string, maxResults int) ([]*model.MessageItem, error) {
	return s.service.DLQ(context.Background(), connID, group, maxResultsOrDefault(maxResults))
}

// Retry returns the retry messages of a consumer group.
func (s *MessageService) Retry(connID int, group string, maxResults int) ([]*model.MessageItem, error) {
	return s.service.Retry(context.Background(), connID, group, maxResultsOrDefault(maxResults))
}

// Resend pushes a message back to a consumer client and returns the new ID.
func (s *MessageService) Resend(connID int, input ResendInput) (string, error) {
	return s.service.Resend(context.Background(), connID,
		input.ConsumerGroup, input.ClientID, input.Topic, input.MessageID)
}

// Send produces a message and returns its ID.
func (s *MessageService) Send(connID int, input SendInput) (string, error) {
	return s.service.Send(context.Background(), connID,
		input.Topic, input.Tags, input.Keys, input.Body, input.DelayLevel)
}
