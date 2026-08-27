// Package crypto provides AES-256-GCM encryption/decryption for sensitive config fields.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	// encryptedPrefix marks encrypted strings so plaintext and ciphertext can be distinguished.
	encryptedPrefix = "ENC:"
	// keyFileName is the filename used to store the encryption key.
	keyFileName = "secret.key"
	// hkdfInfoPrefix namespaces field-level keys under HKDF.
	hkdfInfoPrefix = "mq-studio/field/"
)

var (
	globalKey     []byte
	globalKeyOnce sync.Once
	globalKeyErr  error
)

// getOrCreateKey gets or generates a 256-bit master encryption key.
// The key is persisted under the config directory and generated on first run.
func getOrCreateKey(configDir string) ([]byte, error) {
	keyPath := filepath.Join(configDir, keyFileName)

	data, err := os.ReadFile(keyPath)
	if err == nil {
		decoded, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
		if decErr != nil || len(decoded) != 32 {
			return nil, fmt.Errorf("key file is corrupted; restore from backup or reconfigure credentials: %s", keyPath)
		}
		return decoded, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("failed to read key: %w", err)
	}

	// Generate a new key.
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	// Restrict the config directory so secret.key is not in a world-traversable path.
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, fmt.Errorf("failed to create key directory: %w", err)
	}
	_ = os.Chmod(configDir, 0o700)

	encoded := base64.StdEncoding.EncodeToString(key)
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to save key: %w", err)
	}
	if _, err := file.WriteString(encoded); err != nil {
		_ = file.Close()
		_ = os.Remove(keyPath)
		return nil, fmt.Errorf("failed to save key: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(keyPath)
		return nil, fmt.Errorf("failed to save key: %w", err)
	}

	return key, nil
}

// InitKey initializes the global encryption key; call it at application startup.
func InitKey(configDir string) error {
	globalKeyOnce.Do(func() {
		globalKey, globalKeyErr = getOrCreateKey(configDir)
	})
	return globalKeyErr
}

// deriveFieldKey derives a per-field AES key with HKDF-SHA256.
func deriveFieldKey(masterKey []byte, field string) ([]byte, error) {
	return hkdf.Key(sha256.New, masterKey, nil, hkdfInfoPrefix+field, 32)
}

// deriveFieldKeyLegacy is the pre-HKDF derivation kept for decrypting existing data.
func deriveFieldKeyLegacy(masterKey []byte, field string) []byte {
	h := sha256.New()
	h.Write(masterKey)
	h.Write([]byte(field))
	return h.Sum(nil)
}

func openGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}
	return gcm, nil
}

// Encrypt encrypts a plaintext string and returns Base64 ciphertext with the ENC: prefix.
// Empty strings are not encrypted and are returned as empty strings.
func Encrypt(plaintext string, field string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if globalKey == nil {
		return "", errors.New("encryption key is not initialized")
	}

	key, err := deriveFieldKey(globalKey, field)
	if err != nil {
		return "", fmt.Errorf("failed to derive field key: %w", err)
	}

	gcm, err := openGCM(key)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encryptedPrefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptWithKey(data []byte, key []byte) (string, error) {
	gcm, err := openGCM(key)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext is too short")
	}
	nonce, sealed := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}
	return string(plaintext), nil
}

// Decrypt decrypts a ciphertext string.
// Strings without the ENC: prefix are treated as plaintext and returned as-is (legacy data).
func Decrypt(ciphertext string, field string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	if !strings.HasPrefix(ciphertext, encryptedPrefix) {
		// Compatible with unencrypted legacy data.
		return ciphertext, nil
	}
	if globalKey == nil {
		return "", errors.New("encryption key is not initialized")
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptedPrefix):])
	if err != nil {
		return "", fmt.Errorf("failed to decode ciphertext: %w", err)
	}

	// Prefer HKDF; fall back to legacy SHA-256(master||field) for existing installs.
	if key, err := deriveFieldKey(globalKey, field); err == nil {
		if plain, err := decryptWithKey(data, key); err == nil {
			return plain, nil
		}
	}
	return decryptWithKey(data, deriveFieldKeyLegacy(globalKey, field))
}

// IsEncrypted reports whether the string is encrypted.
func IsEncrypted(s string) bool {
	return strings.HasPrefix(s, encryptedPrefix)
}
