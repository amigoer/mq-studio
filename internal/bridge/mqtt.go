package bridge

import (
	"context"

	mqttdriver "github.com/amigoer/mq-studio/internal/driver/mqtt"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/mqtt"
)

// MQTTService exposes what only MQTT has.
//
// It is one service rather than several because it is one family's surface,
// the same reason KafkaService is one.
//
// Reading retained topics, connected clients and the broker's nodes is not
// here. Those are destinations, client connections and nodes, and the
// canonical services already answer them; a second read path would be two
// sources for one number.
type MQTTService struct {
	service *mqtt.Service
}

// MQTTPublishInput is a publish as the MQTT send console collects it.
//
// Deliberately not MessageService.Publish's shape. That one carries an
// exchange, a routing key, a mandatory flag and a priority, which are AMQP's
// vocabulary and have no MQTT meaning - and it has nowhere to put QoS, the
// retain flag, or the 5.0 properties, which are most of what an MQTT publish
// is. A form that filled the first set in with placeholders would be lying
// about what it sent.
type MQTTPublishInput struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"`

	// QoS decides what an acknowledgement can mean. At 0 there is none at all,
	// and the result says so rather than reporting a delivery.
	QoS byte `json:"qos"`
	// Retain keeps this as the topic's last known value, replayed to whoever
	// subscribes next. It is the only stored state MQTT has.
	Retain bool `json:"retain"`
	// Count sends the same message more than once, for filling a board.
	Count int `json:"count"`

	// Everything below is MQTT 5.0 only, and refused rather than dropped on a
	// 3.1.1 connection.
	ContentType     string            `json:"contentType"`
	ResponseTopic   string            `json:"responseTopic"`
	CorrelationData string            `json:"correlationData"`
	MessageExpiry   uint32            `json:"messageExpiry"`
	UserProperties  map[string]string `json:"userProperties"`
}

func (input MQTTPublishInput) request() mqttdriver.PublishRequest {
	return mqttdriver.PublishRequest{
		Topic:           input.Topic,
		Payload:         input.Payload,
		QoS:             input.QoS,
		Retain:          input.Retain,
		Count:           input.Count,
		ContentType:     input.ContentType,
		ResponseTopic:   input.ResponseTopic,
		CorrelationData: input.CorrelationData,
		MessageExpiry:   input.MessageExpiry,
		UserProperties:  input.UserProperties,
	}
}

// MQTTSubscribeInput asks for a live stream.
type MQTTSubscribeInput struct {
	// Filters are MQTT topic filters, with + and # as the protocol spells
	// them. They are not translated into a neutral form: the two wildcards
	// mean different things and a family-neutral pattern would lose that.
	Filters []MQTTFilterInput `json:"filters"`
	// Buffer bounds what is held between two polls. Zero takes the driver's
	// default.
	Buffer int `json:"buffer"`
}

// MQTTFilterInput is one filter and the QoS to subscribe at.
type MQTTFilterInput struct {
	Pattern string `json:"pattern"`
	QoS     byte   `json:"qos"`
}

func (input MQTTSubscribeInput) spec() model.LiveSubscriptionSpec {
	spec := model.LiveSubscriptionSpec{Buffer: input.Buffer}
	for _, filter := range input.Filters {
		spec.Filters = append(spec.Filters, model.LiveFilter{
			Pattern: filter.Pattern,
			Options: map[string]string{mqttdriver.AttrQoS: itoa(int(filter.QoS))},
		})
	}
	return spec
}

// Publish sends a message with everything MQTT can carry.
func (s *MQTTService) Publish(
	ctx context.Context, connID int, input MQTTPublishInput,
) (*mqttdriver.PublishResult, error) {
	return s.service.Publish(ctx, connID, input.request())
}

// StartSubscription opens a live stream and starts buffering it.
//
// The stream lives on the connection, not on this call: the renderer polls it
// afterwards and has to stop it when its panel closes, because the
// subscription is real on the broker until it does.
func (s *MQTTService) StartSubscription(
	ctx context.Context, connID int, input MQTTSubscribeInput,
) (*model.LiveSubscription, error) {
	return s.service.StartSubscription(ctx, connID, input.spec())
}

// PollSubscription drains what arrived after the caller's last sequence.
func (s *MQTTService) PollSubscription(
	ctx context.Context, connID int, id string, after int64, limit int,
) (*model.LiveBatch, error) {
	return s.service.PollSubscription(ctx, connID, id, after, limit)
}

// StopSubscription ends a stream and unsubscribes on the broker.
func (s *MQTTService) StopSubscription(ctx context.Context, connID int, id string) error {
	return s.service.StopSubscription(ctx, connID, id)
}

// Subscriptions is what this connection is currently streaming.
func (s *MQTTService) Subscriptions(
	ctx context.Context, connID int,
) ([]*model.LiveSubscription, error) {
	return s.service.Subscriptions(ctx, connID)
}

// ClientSubscriptions is the topic filters one client holds.
func (s *MQTTService) ClientSubscriptions(
	ctx context.Context, connID int, clientID string,
) ([]*mqttdriver.ClientSubscription, error) {
	return s.service.ClientSubscriptions(ctx, connID, clientID)
}

// BrokerSubscriptions is every filter the broker is holding, across clients.
func (s *MQTTService) BrokerSubscriptions(
	ctx context.Context, connID int,
) ([]*mqttdriver.ClientSubscription, error) {
	return s.service.BrokerSubscriptions(ctx, connID)
}
