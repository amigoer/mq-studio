package connection

import "time"

// Settings exposes only the application settings required by connection management.
type Settings interface {
	GetConnectTimeout() time.Duration
	GetAutoConnectLast() bool
	GetGlobalACLCredentials() (accessKey, secretKey string)
}
