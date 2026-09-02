package nats

// Attribute keys the NATS boards read off a canonical model.
//
// They are a contract between this package and frontend/src/mq/nats, not part
// of the shared vocabulary: what they mean is NATS's business, and another
// family spelling one of them the same way would be a coincidence. The
// canonical fields carry what every family has - a name, a depth, a subscriber
// count - and everything below is what only this one reports.
const (
	// The stream's shape, as configured.
	AttrSubjects    = "subjects"
	AttrRetention   = "retention"
	AttrStorage     = "storage"
	AttrDiscard     = "discard"
	AttrReplicas    = "replicas"
	AttrMaxMsgs     = "maxMsgs"
	AttrMaxBytes    = "maxBytes"
	AttrMaxAge      = "maxAge"
	AttrMaxMsgSize  = "maxMsgSize"
	AttrMaxMsgsPer  = "maxMsgsPerSubject"
	AttrDuplicates  = "duplicateWindow"
	AttrDescription = "description"
	AttrSealed      = "sealed"
	AttrDenyDelete  = "denyDelete"
	AttrDenyPurge   = "denyPurge"
	AttrAllowRollup = "allowRollup"
	AttrAllowDirect = "allowDirect"
	AttrCompression = "compression"

	// What the stream currently holds. Sequence numbers rather than offsets:
	// a JetStream message is addressed by one number for the whole stream.
	AttrFirstSeq    = "firstSeq"
	AttrLastSeq     = "lastSeq"
	AttrFirstTime   = "firstTime"
	AttrLastTime    = "lastTime"
	AttrBytes       = "bytes"
	AttrNumSubjects = "numSubjects"
	AttrNumDeleted  = "numDeleted"
	AttrCreated     = "created"

	// Where the stream lives. Present only on a clustered stream: a single
	// server reports no cluster at all rather than a cluster of one.
	AttrClusterName = "clusterName"
	AttrLeader      = "leader"
	// AttrReplicaState is one line per peer - name, whether it is current,
	// whether it is offline, and how far behind it is. It is a rendered list
	// rather than structured data because the attribute map is strings, and
	// giving it a shape would mean a model for one family's page.
	AttrReplicaState = "replicaState"
	// AttrReplicasHealthy is how many peers are current, so a board can say
	// "2 of 3" without parsing the line above.
	AttrReplicasHealthy = "replicasHealthy"

	// Whether this stream is a copy of another. A mirror has one source and
	// cannot be published to; sources merge several and can.
	AttrMirrorOf = "mirrorOf"
	AttrSourceOf = "sourceOf"
)
