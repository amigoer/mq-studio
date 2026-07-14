// Package model 定义应用程序的数据模型
package model

// ConnectionEnv 连接环境类型
type ConnectionEnv string

const (
	EnvProduction  ConnectionEnv = "生产"
	EnvTest        ConnectionEnv = "测试"
	EnvDevelopment ConnectionEnv = "开发"
)

// ConnectionStatus 连接状态
type ConnectionStatus string

const (
	StatusOnline  ConnectionStatus = "online"
	StatusOffline ConnectionStatus = "offline"
)

// Connection 连接配置
type Connection struct {
	ID         int              `json:"id"`         // 连接ID
	Name       string           `json:"name"`       // 连接名称
	Env        ConnectionEnv    `json:"env"`        // 环境类型
	NameServer string           `json:"nameServer"` // NameServer 地址
	TimeoutSec int              `json:"timeoutSec"` // 超时时间(秒)
	EnableACL  bool             `json:"enableACL"`  // 是否启用 ACL 认证
	AccessKey  string           `json:"accessKey"`  // ACL AccessKey
	SecretKey  string           `json:"secretKey"`  // ACL SecretKey
	Status     ConnectionStatus `json:"status"`     // 连接状态
	LastCheck  string           `json:"lastCheck"`  // 最近检测时间
	IsDefault  bool             `json:"isDefault"`  // 是否默认连接
	Remark     string           `json:"remark"`     // 备注
}
