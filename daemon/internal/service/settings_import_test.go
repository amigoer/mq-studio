package service

import (
	"bytes"
	"sync"
	"testing"

	"rocket-leaf/internal/crypto"
	"rocket-leaf/internal/model"
)

var initTestCryptoOnce sync.Once
var initTestCryptoErr error

func ensureTestCrypto(t *testing.T) {
	t.Helper()
	initTestCryptoOnce.Do(func() {
		initTestCryptoErr = crypto.InitKey(t.TempDir())
	})
	if initTestCryptoErr != nil {
		t.Fatalf("初始化测试密钥失败: %v", initTestCryptoErr)
	}
}

func TestConnectionExportImportRoundTrip(t *testing.T) {
	ensureTestCrypto(t)
	store := connectionStore{Connections: []*model.Connection{{
		ID:         7,
		Name:       "生产",
		Env:        model.EnvProduction,
		NameServer: "ns-a:9876;ns-b:9876",
		TimeoutSec: 5,
		EnableACL:  true,
		AccessKey:  "portable-ak",
		SecretKey:  "portable-sk",
		IsDefault:  true,
	}}}

	diskData, err := marshalConnectionsForDisk(store)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(diskData, []byte("portable-ak")) || bytes.Contains(diskData, []byte("portable-sk")) {
		t.Fatal("本地连接文件不得包含明文凭据")
	}

	decoded, err := decodeConnectionStore(diskData, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded.Connections) != 1 || decoded.Connections[0].AccessKey != "portable-ak" || decoded.Connections[0].SecretKey != "portable-sk" {
		t.Fatalf("连接配置往返失败: %#v", decoded.Connections)
	}
}

func TestVersion2ConnectionCredentialsKeepENCPrefixAsPlaintext(t *testing.T) {
	ensureTestCrypto(t)
	raw := []byte(`{"connections":[{"id":1,"name":"测试","nameServer":"127.0.0.1:9876","timeoutSec":5,"enableAcl":true,"accessKey":"ENC:literal-ak","secretKey":"ENC:literal-sk"}]}`)
	store, err := decodeConnectionStore(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.Connections[0].AccessKey; got != "ENC:literal-ak" {
		t.Fatalf("v2 明文凭据被误解密: %q", got)
	}
	diskData, err := marshalConnectionsForDisk(store)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeConnectionStore(diskData, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := decoded.Connections[0].SecretKey; got != "ENC:literal-sk" {
		t.Fatalf("以 ENC: 开头的真实凭据未能往返: %q", got)
	}
}

func TestNormalizeSettingsKeepsZeroLagThreshold(t *testing.T) {
	settings := *model.DefaultSettings()
	settings.LagAlertThreshold = 0
	settings.FetchLimit = -1
	normalized := normalizeSettings(settings)
	if normalized.LagAlertThreshold != 0 {
		t.Fatalf("0 应表示关闭积压告警，got %d", normalized.LagAlertThreshold)
	}
	if normalized.FetchLimit != model.DefaultSettings().FetchLimit {
		t.Fatalf("非法拉取数量应恢复默认值，got %d", normalized.FetchLimit)
	}
}
