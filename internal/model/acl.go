package model

// AclVersionInfo holds ACL config version information.
type AclVersionInfo struct {
	BrokerAddr  string `json:"brokerAddr"`
	BrokerName  string `json:"brokerName"`
	ClusterName string `json:"clusterName"`
	Version     string `json:"version"`
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
