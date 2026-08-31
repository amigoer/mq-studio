package rabbitmq

import (
	"context"
	"fmt"

	"github.com/amigoer/mq-studio/internal/model"
)

// Everything that touches a message now goes over AMQP: browsing in
// message_browse.go, publishing in message_publish.go. What is left here is
// the one thing RabbitMQ cannot do at all.

// MessageByID is not offered: RabbitMQ assigns no stable identifier a message
// could be fetched back by. The capability is not declared, so nothing calls
// this.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	return nil, fmt.Errorf("rabbitmq messages have no stable id to look up")
}
