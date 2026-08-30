package rocketmq

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on a Destination. They are a contract
// between this file and frontend/src/mq/rocketmq, not part of the shared
// vocabulary.
const (
	AttrReadQueue      = "readQueue"
	AttrWriteQueue     = "writeQueue"
	AttrPerm           = "perm"
	AttrMessageType    = "messageType"
	AttrCluster        = "cluster"
	AttrDescription    = "description"
	AttrConsumerGroups = "consumerGroups"

	// AttrRoutes holds the per-broker route table as JSON.
	//
	// Attributes is map[string]string, which carries scalars fine and
	// structured data only by encoding it. That is a real limit of the
	// escape hatch rather than a preference, and it wants settling before a
	// second driver leans on it.
	AttrRoutes = "routes"
	// AttrSubscribers holds the subscribing group names as JSON. Only a
	// per-topic lookup fills it.
	AttrSubscribers = "subscribers"
)

// ListDestinations returns topics, hiding the system ones unless asked.
func (c *Conn) ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	var (
		topics []*model.TopicItem
		err    error
	)
	switch {
	case filter.Namespace != "":
		topics, err = c.GetTopicsByCluster(ctx, filter.Namespace)
	case filter.IncludeInternal:
		topics, err = c.GetAllTopics(ctx)
	default:
		topics, err = c.GetTopics(ctx)
	}
	if err != nil {
		return nil, err
	}
	return destinationsFromTopics(topics), nil
}

// DestinationStats reports the per-queue offset ranges of a topic.
func (c *Conn) DestinationStats(ctx context.Context, ref model.DestinationRef) (map[string]interface{}, error) {
	return c.GetTopicStats(ctx, ref.Name)
}

// DestinationDetail returns one topic with its routes.
func (c *Conn) DestinationDetail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error) {
	topic, err := c.GetTopicDetail(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	return destinationFromTopic(topic), nil
}

// CreateDestination adds a topic on the target broker.
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	broker, read, write, perm := topicConfigFromSpec(spec)
	return c.CreateTopic(ctx, spec.Ref.Name, broker, read, write, perm)
}

// UpdateDestination changes an existing topic's configuration.
func (c *Conn) UpdateDestination(ctx context.Context, spec model.DestinationSpec) error {
	broker, read, write, perm := topicConfigFromSpec(spec)
	return c.UpdateTopic(ctx, spec.Ref.Name, broker, read, write, perm)
}

// RemoveDestination deletes a topic from the cluster.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	return c.DeleteTopic(ctx, ref.Name, ref.Namespace)
}

func topicConfigFromSpec(spec model.DestinationSpec) (broker string, read, write int, perm string) {
	broker = spec.Attributes["brokerAddr"]
	read = atoiOr(spec.Attributes[AttrReadQueue], model.UnknownMetric)
	write = atoiOr(spec.Attributes[AttrWriteQueue], model.UnknownMetric)
	perm = spec.Attributes[AttrPerm]
	return broker, read, write, perm
}

func destinationsFromTopics(topics []*model.TopicItem) []*model.Destination {
	destinations := make([]*model.Destination, 0, len(topics))
	for _, topic := range topics {
		destinations = append(destinations, destinationFromTopic(topic))
	}
	return destinations
}

// destinationFromTopic maps RocketMQ's topic shape onto the canonical one.
//
// The topic model stays the driver's internal representation: the enrichment
// code that fills it is careful, well covered, and moving it onto a different
// struct would have meant rewriting its tests, which is exactly what this
// refactor is not allowed to do.
func destinationFromTopic(topic *model.TopicItem) *model.Destination {
	if topic == nil {
		return nil
	}
	attributes := map[string]string{
		AttrReadQueue:      strconv.Itoa(topic.ReadQueue),
		AttrWriteQueue:     strconv.Itoa(topic.WriteQueue),
		AttrPerm:           string(topic.Perm),
		AttrMessageType:    string(topic.MessageType),
		AttrCluster:        topic.Cluster,
		AttrDescription:    topic.Description,
		AttrConsumerGroups: strconv.Itoa(topic.ConsumerGroups),
	}
	if len(topic.Routes) > 0 {
		if encoded, err := json.Marshal(topic.Routes); err == nil {
			attributes[AttrRoutes] = string(encoded)
		}
	}
	if len(topic.Subscribers) > 0 {
		if encoded, err := json.Marshal(topic.Subscribers); err == nil {
			attributes[AttrSubscribers] = string(encoded)
		}
	}

	return &model.Destination{
		Ref:         model.DestinationRef{Namespace: topic.Cluster, Name: topic.Topic},
		Partitions:  topic.WriteQueue,
		Subscribers: topic.ConsumerGroups,
		Depth:       model.UnknownMetric,
		RateIn:      topic.TpsIn,
		RateOut:     topic.TpsOut,
		LastUpdated: topic.LastUpdated,
		Attributes:  attributes,
	}
}

// TopicFromDestination rebuilds the RocketMQ shape the current bridge still
// speaks. It disappears when the renderer moves onto the canonical model.
func TopicFromDestination(destination *model.Destination) *model.TopicItem {
	if destination == nil {
		return nil
	}
	topic := &model.TopicItem{
		ID:             destination.ID,
		Topic:          destination.Ref.Name,
		Cluster:        destination.Attribute(AttrCluster),
		ReadQueue:      atoiOr(destination.Attribute(AttrReadQueue), model.UnknownMetric),
		WriteQueue:     atoiOr(destination.Attribute(AttrWriteQueue), model.UnknownMetric),
		Perm:           model.TopicPerm(destination.Attribute(AttrPerm)),
		MessageType:    model.TopicMessageType(destination.Attribute(AttrMessageType)),
		ConsumerGroups: atoiOr(destination.Attribute(AttrConsumerGroups), model.UnknownMetric),
		TpsIn:          destination.RateIn,
		TpsOut:         destination.RateOut,
		LastUpdated:    destination.LastUpdated,
		Description:    destination.Attribute(AttrDescription),
	}
	if encoded := destination.Attribute(AttrRoutes); encoded != "" {
		var routes []model.TopicRouteItem
		if json.Unmarshal([]byte(encoded), &routes) == nil {
			topic.Routes = routes
		}
	}
	return topic
}

func atoiOr(raw string, fallback int) int {
	if value, err := strconv.Atoi(raw); err == nil {
		return value
	}
	return fallback
}
