package model

// AclVersionInfo holds ACL config version information.
type AclVersionInfo struct {
	BrokerAddr  string `json:"brokerAddr"`
	BrokerName  string `json:"brokerName"`
	ClusterName string `json:"clusterName"`
	Version     string `json:"version"`
}

// AccessPrincipal is one identity the broker authenticates.
//
// RocketMQ 5.3 calls it a user, Kafka a principal. Type and status stay the
// family's own words: what values they take differs per family, and
// normalising them would lose exactly what an operator has to type back.
type AccessPrincipal struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// AccessPrincipalSpec creates or updates a principal.
//
// Secret is write-only and never travels back: the broker stores it hashed and
// there is nothing to show even if it did.
type AccessPrincipalSpec struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// AccessRule is everything one subject is permitted to do.
//
// Identity-based rather than key-based, which is what separates it from
// AccessConfig: a rule names a subject the broker already knows, where an
// AccessConfig carries the credential and the permissions together.
type AccessRule struct {
	Subject     string         `json:"subject"`
	Policies    []AccessPolicy `json:"policies"`
	Description string         `json:"description"`
}

// AccessPolicy grants or denies actions on one resource.
type AccessPolicy struct {
	Resource string   `json:"resource"` // a topic, a group, or the cluster
	Actions  []string `json:"actions"`  // PUB, SUB, and the family's own verbs
	Effect   string   `json:"effect"`   // Allow, Deny

	// SourceIPs narrows the rule to callers from these addresses. Empty means
	// any source.
	SourceIPs []string `json:"sourceIps"`

	// Decision is what the broker actually decided for this policy, which is
	// not always its effect - a later rule can override an earlier one.
	Decision string `json:"decision"`
}

// AccessConfig is one access-control entry.
//
// The shape follows RocketMQ ACL, the only implementation today. It is a
// struct rather than the eight positional arguments the service used, so a
// caller cannot silently transpose two permission lists.
type AccessConfig struct {
	AccessKey          string   `json:"accessKey"`
	SecretKey          string   `json:"secretKey"` // write-only; never sent back
	WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
	IsAdmin            bool     `json:"isAdmin"`
	DefaultTopicPerm   string   `json:"defaultTopicPerm"`
	DefaultGroupPerm   string   `json:"defaultGroupPerm"`
	TopicPerms         []string `json:"topicPerms"`
	GroupPerms         []string `json:"groupPerms"`
}
