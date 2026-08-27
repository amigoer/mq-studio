package connection

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
)

var (
	initTestCryptoOnce sync.Once
	initTestCryptoErr  error
)

type fakeSettings struct {
	connectTimeout time.Duration
	autoConnect    bool
	accessKey      string
	secretKey      string
}

func (s fakeSettings) GetConnectTimeout() time.Duration {
	return s.connectTimeout
}

func (s fakeSettings) GetAutoConnectLast() bool {
	return s.autoConnect
}

func (s fakeSettings) GetGlobalACLCredentials() (string, string) {
	return s.accessKey, s.secretKey
}

func ensureTestCrypto(t *testing.T) {
	t.Helper()
	initTestCryptoOnce.Do(func() {
		initTestCryptoErr = crypto.InitKey(t.TempDir())
	})
	if initTestCryptoErr != nil {
		t.Fatalf("initialize test encryption key: %v", initTestCryptoErr)
	}
}

func newTestService(t *testing.T, settings Settings) *Service {
	t.Helper()
	ensureTestCrypto(t)
	if settings == nil {
		settings = fakeSettings{connectTimeout: 3 * time.Second, autoConnect: true}
	}
	return New(filepath.Join(t.TempDir(), "connections.json"), settings, noopRuntime{})
}

// noopRuntime stands in where a test only exercises profile persistence. The
// tests that care about client lifecycle replace service.runtime with a fake
// that records calls.
type noopRuntime struct{}

func (noopRuntime) Connect(string, time.Duration, bool, string, string) error { return nil }
func (noopRuntime) HasClient(string) bool                                     { return false }
func (noopRuntime) SetDefault(string) error                                   { return nil }
func (noopRuntime) Remove(string)                                             {}
func (noopRuntime) Test(string, time.Duration, bool, string, string) error    { return nil }
func (noopRuntime) CloseAll()                                                 {}
