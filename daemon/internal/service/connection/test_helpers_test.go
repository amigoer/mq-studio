package connection

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
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
	return New(filepath.Join(t.TempDir(), "connections.json"), settings)
}
