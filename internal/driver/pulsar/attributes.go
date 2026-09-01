package pulsar

// Attribute keys this driver puts on the canonical models.
//
// Every key here is a contract with frontend/src/mq/pulsar/attributes.ts, and
// nothing else in the frontend reads one directly. The two files are asserted
// equal by TestAttributeKeysMatchTheFrontendModule, because a key renamed on
// one side is a column that silently reads empty on the other - which looks
// like a cluster with nothing to report rather than a bug.
//
// Only what the canonical model has no field for belongs here. A figure that
// fits Node or Destination goes in the field, so the shared pages can read it
// without knowing which family answered.
const (
	// AttrNodeLeader marks the broker currently holding the load-manager
	// leadership. Pulsar brokers are otherwise peers - there is no master and
	// slave - so this is the only role a node has.
	AttrNodeLeader = "pulsarLeader"

	// AttrNodeServiceURL is the broker's own binary address, which is not the
	// one this connection dialled: the profile names one endpoint and the
	// cluster may front several brokers behind it.
	AttrNodeServiceURL = "pulsarServiceUrl"

	// AttrNodeVersion is reported by the load manager rather than by the
	// broker listing, so it is absent on a cluster whose load manager does
	// not publish reports.
	AttrNodeVersion = "pulsarBrokerVersion"

	// Resource usage as a percentage of each limit the broker reports. CPU is
	// scaled across every core, so its limit is 100 per core and a raw usage
	// figure means nothing without it.
	AttrNodeCPUPercent          = "pulsarCpuPercent"
	AttrNodeMemoryPercent       = "pulsarMemoryPercent"
	AttrNodeDirectMemoryPercent = "pulsarDirectMemoryPercent"

	// What the broker is currently carrying. Bundles are Pulsar's unit of
	// ownership: a namespace is split into them and each is owned by one
	// broker, so an uneven bundle count is what an unbalanced cluster looks
	// like before it shows up in the rates.
	AttrNodeBundles   = "pulsarBundles"
	AttrNodeTopics    = "pulsarTopics"
	AttrNodeProducers = "pulsarProducers"
	AttrNodeConsumers = "pulsarConsumers"

	// AttrClusterName is the cluster the profile's admin API belongs to.
	AttrClusterName = "pulsarCluster"

	// AttrClusterBrokerServiceURL and AttrClusterServiceURL are the addresses
	// the cluster publishes for clients, which are not necessarily the ones
	// this profile was configured with.
	AttrClusterServiceURL       = "pulsarClusterWebServiceUrl"
	AttrClusterBrokerServiceURL = "pulsarClusterBrokerServiceUrl"

	// AttrClusterMetadataStore names the metadata store the cluster keeps its
	// state in. It is Pulsar's discovery tier, and the closest thing the
	// family has to a name server worth naming on a page.
	AttrClusterMetadataStore = "pulsarMetadataStore"
)

// Destination.
const (
	// AttrTopicPersistent is the scheme a topic was declared with. It is an
	// attribute rather than part of the ref because it is a property of the
	// topic, not part of its address within a namespace.
	AttrTopicPersistent = "pulsarPersistent"

	// AttrTopicStorageBytes is what the topic occupies in BookKeeper. Distinct
	// from the backlog: retention keeps acknowledged messages on disk, so a
	// topic every subscription has caught up with still has a size.
	AttrTopicStorageBytes = "pulsarStorageBytes"

	// AttrTopicProducers is how many are currently attached. Pulsar reports
	// them per topic, which is why this family can answer the question at all.
	AttrTopicProducers = "pulsarTopicProducers"

	// AttrTopicAverageMessageBytes is what the broker has seen on this topic,
	// which is the figure that turns a backlog count into an idea of size.
	AttrTopicAverageMessageBytes = "pulsarAverageMessageBytes"
)

// Subscription.
const (
	// AttrSubscriptionTopic is the topic this subscription belongs to. Also in
	// the ref's namespace field, and repeated here because the subscription
	// board reads its columns through this module rather than through the ref.
	AttrSubscriptionTopic = "pulsarSubscriptionTopic"

	// AttrSubscriptionType is Exclusive, Shared, Failover or Key_Shared. It is
	// chosen by the consumers that attach rather than stored as configuration,
	// which is why it is reported and never edited.
	AttrSubscriptionType = "pulsarSubscriptionType"

	// AttrSubscriptionDurable distinguishes a cursor the broker persists from
	// a reader's own position, which vanishes when it disconnects.
	AttrSubscriptionDurable = "pulsarSubscriptionDurable"

	// AttrSubscriptionUnacked is what has been delivered and not acknowledged.
	// It is the figure behind a blocked subscription: past the broker's limit
	// delivery stops entirely.
	AttrSubscriptionUnacked = "pulsarSubscriptionUnacked"

	// AttrSubscriptionDelayed is what is scheduled for later and therefore
	// counted in the backlog while being nobody's fault.
	AttrSubscriptionDelayed = "pulsarSubscriptionDelayed"

	// AttrSubscriptionBacklogB is the backlog in bytes, which is what decides
	// whether a namespace's backlog quota is about to bite.
	AttrSubscriptionBacklogB = "pulsarSubscriptionBacklogBytes"

	// AttrSubscriptionBlocked is the broker having stopped delivering because
	// of unacknowledged messages. It looks exactly like a stalled consumer
	// from the backlog alone and is fixed somewhere completely different.
	AttrSubscriptionBlocked = "pulsarSubscriptionBlocked"

	// AttrSubscriptionRedeliverRate is how fast messages are going round
	// again, which is what a failing consumer looks like from the broker.
	AttrSubscriptionRedeliverRate = "pulsarSubscriptionRedeliverRate"

	// AttrSubscriptionActiveConsumer names the one consumer receiving on a
	// Failover subscription, where the others are standing by.
	AttrSubscriptionActiveConsumer = "pulsarSubscriptionActiveConsumer"

	// AttrSubscriptionStartAt is a create-only input: where a new subscription
	// begins reading.
	AttrSubscriptionStartAt = "pulsarSubscriptionStartAt"
)

// Where a newly created subscription starts.
//
// Earliest is the default and the reason the control exists: a subscription
// created at the latest position silently discards whatever is already on the
// topic, which is the opposite of why somebody creates one ahead of a consumer.
const (
	StartAtEarliest = "earliest"
	StartAtLatest   = "latest"
)
