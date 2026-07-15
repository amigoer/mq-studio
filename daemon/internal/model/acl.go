package model

// AclVersionInfo ACL 配置版本信息
type AclVersionInfo struct {
	BrokerAddr  string `json:"brokerAddr"`
	BrokerName  string `json:"brokerName"`
	ClusterName string `json:"clusterName"`
	Version     string `json:"version"`
}
