package connection

import "time"

// ClientRuntime is the mutable client registry, isolated from profile
// persistence so lifecycle transactions can be tested deterministically.
//
// The implementation lives in the composition root rather than here: binding
// it in this package is what made connection management import a driver, and
// a profile store has no business knowing which broker family it stores
// profiles for.
//
// It is still keyed by endpoint. Re-keying it by profile id belongs with the
// ConnectionProfile migration, because that is the commit where a connection
// gets an identity independent of its address.
type ClientRuntime interface {
	Connect(endpoint string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error
	HasClient(endpoint string) bool
	SetDefault(endpoint string) error
	Remove(endpoint string)
	Test(endpoint string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error
	CloseAll()
}
