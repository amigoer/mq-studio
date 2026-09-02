package rocketmq

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
)

// FilterTag narrows a query to one RocketMQ message tag.
const FilterTag = "tag"

// QueryMessages browses stored messages.
func (c *Conn) QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	return c.queryMessagesBy(ctx, c.wrap(params.Topic), params.MessageKey, params.Filters[FilterTag],
		params.MaxResults, params.StartTime, params.EndTime)
}

// MessageByID returns one message by its RocketMQ message id.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	return c.QueryMessageByID(ctx, c.wrap(topic), messageID)
}

// TrackMessage reports which consumer groups have consumed a message.
func (c *Conn) TrackMessage(ctx context.Context, topic, messageID string) ([]*model.MessageTrackItem, error) {
	return c.GetMessageTrack(ctx, c.wrap(topic), messageID)
}

// DLQMessages browses a group's dead-letter backlog.
func (c *Conn) DLQMessages(ctx context.Context, group string, maxResults int) ([]*model.MessageItem, error) {
	return c.QueryDLQMessages(ctx, c.wrap(group), maxResults)
}

// RetryMessages browses a group's retry backlog.
func (c *Conn) RetryMessages(ctx context.Context, group string, maxResults int) ([]*model.MessageItem, error) {
	return c.QueryRetryMessages(ctx, c.wrap(group), maxResults)
}
