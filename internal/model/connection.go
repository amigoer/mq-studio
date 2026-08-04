// Package model defines the application's data models.
package model

// ConnectionEnv is the connection environment type.
type ConnectionEnv string

const (
	EnvProduction  ConnectionEnv = "production"
	EnvTest        ConnectionEnv = "test"
	EnvDevelopment ConnectionEnv = "development"
)

// ConnectionStatus is the connection status.
type ConnectionStatus string

const (
	StatusOnline  ConnectionStatus = "online"
	StatusOffline ConnectionStatus = "offline"
)

// Connection holds connection configuration.
type Connection struct {
	ID         int              `json:"id"`         // Connection ID
	Name       string           `json:"name"`       // Connection name
	Env        ConnectionEnv    `json:"env"`        // Environment type
	NameServer string           `json:"nameServer"` // NameServer address
	TimeoutSec int              `json:"timeoutSec"` // Timeout in seconds
	EnableACL  bool             `json:"enableACL"`  // Whether ACL authentication is enabled
	AccessKey  string           `json:"accessKey"`  // ACL AccessKey
	SecretKey  string           `json:"secretKey"`  // ACL SecretKey
	Status     ConnectionStatus `json:"status"`     // Connection status
	LastCheck  string           `json:"lastCheck"`  // Last health-check time
	IsDefault  bool             `json:"isDefault"`  // Whether this is the default connection
	Remark     string           `json:"remark"`     // Remark
}
