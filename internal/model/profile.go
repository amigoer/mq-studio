package model

import "slices"

// AuthMechanism is how a connection authenticates.
type AuthMechanism string

const (
	AuthNone      AuthMechanism = "none"
	AuthACL       AuthMechanism = "acl" // RocketMQ AccessKey / SecretKey
	AuthPlain     AuthMechanism = "plain"
	AuthSASLPlain AuthMechanism = "sasl-plain"
	AuthSASLScram AuthMechanism = "sasl-scram"
	AuthToken     AuthMechanism = "token"
	AuthMutualTLS AuthMechanism = "mtls"
)

// AuthConfig carries the non-secret half of a connection's credentials.
// The secret half lives in ConnectionProfile.Secrets.
type AuthConfig struct {
	Mechanism AuthMechanism `json:"mechanism"`
}

// ConnectionProfile is one saved connection, of any family.
//
// It replaces Connection, whose NameServer / EnableACL / AccessKey / SecretKey
// fields were RocketMQ concepts sitting in the shared schema.
type ConnectionProfile struct {
	ID         int              `json:"id"`
	Name       string           `json:"name"`
	Group      string           `json:"group"` // free-form label; empty means ungrouped
	Kind       MQKind           `json:"kind"`
	Endpoints  string           `json:"endpoints"` // driver parses; replaces NameServer
	TimeoutSec int              `json:"timeoutSec"`
	Auth       AuthConfig       `json:"auth"`
	Status     ConnectionStatus `json:"status"`
	LastCheck  string           `json:"lastCheck"`
	IsDefault  bool             `json:"isDefault"`
	Remark     string           `json:"remark"`

	// Options holds non-secret driver-specific settings, validated against the
	// driver's form schema. It is what lets a new family add fields without
	// changing the stored schema.
	Options map[string]string `json:"options"`

	// Secrets is encrypted at rest and never leaves the Go process. The bridge
	// replaces it with the list of configured key names.
	Secrets map[string]string `json:"-"`
}

// Option returns a driver-specific setting.
func (p *ConnectionProfile) Option(key string) string {
	return p.Options[key]
}

// Secret returns a stored credential.
func (p *ConnectionProfile) Secret(key string) string {
	return p.Secrets[key]
}

// ConfiguredSecrets lists the credential keys that hold a value. It is what
// the bridge sends instead of the secrets themselves, so a form can show
// "already set" without the value ever reaching the renderer.
//
// The result is sorted: map order would otherwise change between calls and
// make the renderer re-render on an unchanged connection.
func (p *ConnectionProfile) ConfiguredSecrets() []string {
	configured := make([]string, 0, len(p.Secrets))
	for key, value := range p.Secrets {
		if value != "" {
			configured = append(configured, key)
		}
	}
	slices.Sort(configured)
	return configured
}
