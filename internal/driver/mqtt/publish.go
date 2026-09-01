package mqtt

import (
	"context"
	"fmt"
)

// maxPublishCount bounds one press of the send button. The console offers a
// repeat count so a board can be given something to show; it is not a load
// generator, and a mistyped count should not fill a broker.
const maxPublishCount = 1000

// PublishRequest is one MQTT publish.
//
// It is this package's own type rather than model.PublishRequest, which is
// AMQP-shaped: exchange, routing key, mandatory, priority and app id have no
// MQTT counterpart, and QoS, retain and the 5.0 properties have no AMQP one.
// Reaching for the shared struct would have meant a form of fields that do
// nothing beside fields that cannot be set. Kafka's RecordRequest is here for
// the same reason.
type PublishRequest struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"`
	// QoS is 0, 1 or 2. It decides what Acknowledged can mean below.
	QoS byte `json:"qos"`
	// Retain asks the broker to keep this as the topic's last known value and
	// hand it to anyone who subscribes later. It is the closest thing MQTT has
	// to stored state, and the only reason a topic can be listed at all.
	Retain bool `json:"retain"`
	// Count sends the same message more than once, for filling a board.
	Count int `json:"count"`

	// Everything below is MQTT 5.0 only. Under 3.1.1 a publish carrying any of
	// them is refused rather than silently stripped: a correlation id that
	// vanished in transit is worse than one that was never accepted.
	ContentType     string            `json:"contentType"`
	ResponseTopic   string            `json:"responseTopic"`
	CorrelationData string            `json:"correlationData"`
	MessageExpiry   uint32            `json:"messageExpiry"`
	UserProperties  map[string]string `json:"userProperties"`
}

// PublishResult is what the broker said, which depends on how much was asked.
type PublishResult struct {
	// Sent is how many of Count went out.
	Sent int `json:"sent"`

	// Acknowledged is false at QoS 0, where the protocol has no
	// acknowledgement at all: the message reached the socket and nothing
	// further is knowable. Reporting that honestly is the difference between
	// "the broker has it" and "we wrote it somewhere".
	Acknowledged bool `json:"acknowledged"`

	// NoMatchingSubscribers is the broker saying it took the message and had
	// nobody to give it to (5.0 reason code 16). It is not a failure - MQTT
	// has no mandatory flag and a retained publish is often meant for nobody
	// yet - but it is the difference between a send that did something and one
	// that did not.
	NoMatchingSubscribers bool `json:"noMatchingSubscribers"`

	// ReasonCode and Reason are the broker's own answer. 3.1.1 has neither, so
	// they stay zero and empty there rather than being invented.
	ReasonCode int    `json:"reasonCode"`
	Reason     string `json:"reason"`
}

// Publish sends a message and reports what the broker made of it.
func (c *Conn) Publish(ctx context.Context, request PublishRequest) (*PublishResult, error) {
	if c.client == nil {
		return nil, errConnectionDown
	}
	if request.Topic == "" {
		return nil, fmt.Errorf("a publish needs a topic")
	}
	// Wildcards are for subscribing. A broker rejects them on a publish, and
	// some close the connection rather than answer, so this is caught here.
	if containsWildcard(request.Topic) {
		return nil, fmt.Errorf("a topic to publish to cannot contain + or #")
	}
	if request.QoS > 2 {
		return nil, fmt.Errorf("qos must be 0, 1 or 2, not %d", request.QoS)
	}
	if request.Count > maxPublishCount {
		return nil, fmt.Errorf("count must be at most %d", maxPublishCount)
	}
	if !c.config.ProtocolV5 {
		if err := refuseV5Properties(request); err != nil {
			return nil, err
		}
	}

	count := request.Count
	if count <= 0 {
		count = 1
	}

	result := &PublishResult{Acknowledged: request.QoS > 0}
	for range count {
		answer, err := c.client.Publish(ctx, request)
		if err != nil {
			// Whatever went out already did go out; saying otherwise would
			// have the user send the whole batch again.
			return result, err
		}
		result.Sent++
		if answer != nil {
			result.ReasonCode = answer.ReasonCode
			result.Reason = answer.Reason
			result.NoMatchingSubscribers = answer.NoMatchingSubscribers
		}
	}
	return result, nil
}

// SendMessage is the canonical publish, which every family answers so the
// shared send path has something to call.
//
// Two of its five arguments are RocketMQ's vocabulary and are refused rather
// than mapped: MQTT has no tag and no message key, and quietly dropping either
// would report success for a message that arrived without it. Delay levels are
// refused for the same reason - a broker-side scheduler is not something MQTT
// has.
func (c *Conn) SendMessage(
	ctx context.Context, topic, tags, keys, body string, delayLevel int,
) (string, error) {
	if delayLevel != 0 {
		return "", fmt.Errorf("mqtt has no delayed delivery")
	}
	if tags != "" {
		return "", fmt.Errorf("mqtt messages have no tags")
	}
	if keys != "" {
		return "", fmt.Errorf("mqtt messages have no keys; use a correlation id under 5.0")
	}

	// QoS 1 rather than 0, because the caller is a person watching for an
	// answer: at QoS 0 a wrong topic and a working one look identical.
	if _, err := c.Publish(ctx, PublishRequest{Topic: topic, Payload: body, QoS: 1}); err != nil {
		return "", err
	}
	// MQTT has no message identifier. The packet id of a QoS 1 publish is
	// reused within seconds and means nothing to the broker afterwards, so the
	// topic is the only thing worth handing back.
	return topic, nil
}

// refuseV5Properties names the field that cannot cross, rather than reporting
// a generic version error: the user set it on a form and needs to know which
// control to clear.
func refuseV5Properties(request PublishRequest) error {
	switch {
	case request.ContentType != "":
		return fmt.Errorf("content type is an MQTT 5.0 property; this connection is 3.1.1")
	case request.ResponseTopic != "":
		return fmt.Errorf("response topic is an MQTT 5.0 property; this connection is 3.1.1")
	case request.CorrelationData != "":
		return fmt.Errorf("correlation data is an MQTT 5.0 property; this connection is 3.1.1")
	case request.MessageExpiry != 0:
		return fmt.Errorf("message expiry is an MQTT 5.0 property; this connection is 3.1.1")
	case len(request.UserProperties) != 0:
		return fmt.Errorf("user properties are an MQTT 5.0 feature; this connection is 3.1.1")
	default:
		return nil
	}
}

// containsWildcard reports the two subscription wildcards. They are only
// special in a filter, so a publish carrying one is a mistake every time.
func containsWildcard(topic string) bool {
	for _, r := range topic {
		if r == '+' || r == '#' {
			return true
		}
	}
	return false
}
