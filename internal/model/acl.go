package model

// AclVersionInfo holds ACL config version information.
type AclVersionInfo struct {
	BrokerAddr  string `json:"brokerAddr"`
	BrokerName  string `json:"brokerName"`
	ClusterName string `json:"clusterName"`
	Version     string `json:"version"`
}
