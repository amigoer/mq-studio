package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := InitKey(dir); err != nil {
		// InitKey uses sync.Once; if already initialized in another test, ensure key exists
		if _, e := os.Stat(filepath.Join(dir, keyFileName)); e != nil {
			// force re-init path by creating key via getOrCreateKey
			k, err2 := getOrCreateKey(dir)
			if err2 != nil {
				t.Fatalf("init key: %v / %v", err, err2)
			}
			globalKey = k
			globalKeyErr = nil
		}
	}

	// Prefer a clean isolated key for this package test process
	key, err := getOrCreateKey(dir)
	if err != nil {
		t.Fatalf("getOrCreateKey: %v", err)
	}
	// Temporarily override global key
	prev := globalKey
	globalKey = key
	t.Cleanup(func() { globalKey = prev })

	plain := "super-secret-ak-123"
	enc, err := Encrypt(plain, "accessKey")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if enc == plain || enc == "" {
		t.Fatalf("expected ciphertext, got %q", enc)
	}
	if enc[:4] != encryptedPrefix {
		t.Fatalf("missing ENC: prefix: %q", enc)
	}

	dec, err := Decrypt(enc, "accessKey")
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if dec != plain {
		t.Fatalf("round-trip mismatch: got %q want %q", dec, plain)
	}
}

func TestEncryptEmpty(t *testing.T) {
	enc, err := Encrypt("", "accessKey")
	if err != nil {
		t.Fatalf("Encrypt empty: %v", err)
	}
	if enc != "" {
		t.Fatalf("expected empty, got %q", enc)
	}
}

func TestDecryptPlaintextPassthrough(t *testing.T) {
	// Non-ENC strings pass through for backward compatibility
	got, err := Decrypt("not-encrypted", "accessKey")
	if err != nil {
		t.Fatalf("Decrypt plaintext: %v", err)
	}
	if got != "not-encrypted" {
		t.Fatalf("got %q", got)
	}
}

func TestCorruptedKeyIsNotOverwritten(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, keyFileName)
	original := []byte("not-a-valid-key")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := getOrCreateKey(dir); err == nil {
		t.Fatal("损坏的密钥必须返回错误")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(original) {
		t.Fatalf("损坏密钥不应被覆盖: got %q", after)
	}
}

func TestDecryptLegacyFieldKey(t *testing.T) {
	dir := t.TempDir()
	key, err := getOrCreateKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	prev := globalKey
	globalKey = key
	t.Cleanup(func() { globalKey = prev })

	// Encrypt with the legacy SHA-256(master||field) derivation.
	legacyKey := deriveFieldKeyLegacy(key, "accessKey")
	gcm, err := openGCM(legacyKey)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatal(err)
	}
	sealed := gcm.Seal(nonce, nonce, []byte("legacy-secret"), nil)
	ciphertext := encryptedPrefix + base64.StdEncoding.EncodeToString(sealed)

	got, err := Decrypt(ciphertext, "accessKey")
	if err != nil {
		t.Fatalf("Decrypt legacy: %v", err)
	}
	if got != "legacy-secret" {
		t.Fatalf("got %q", got)
	}
}
