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
