// Package crypto 提供 AES-256-GCM 加密/解密功能，用于保护敏感配置字段
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
	// encryptedPrefix 标识加密后的字符串，用于区分明文和密文
	encryptedPrefix = "ENC:"
	// keyFileName 存储加密密钥的文件名
	keyFileName = "secret.key"
	// hkdfInfoPrefix namespaces field-level keys under HKDF.
	hkdfInfoPrefix = "rocket-leaf/field/"
)

var (
	globalKey     []byte
	globalKeyOnce sync.Once
	globalKeyErr  error
)

// getOrCreateKey 获取或生成 256 位加密主密钥
// 密钥持久化在配置目录下，首次运行时自动生成
func getOrCreateKey(configDir string) ([]byte, error) {
	keyPath := filepath.Join(configDir, keyFileName)

	data, err := os.ReadFile(keyPath)
	if err == nil {
		decoded, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
		if decErr != nil || len(decoded) != 32 {
			return nil, fmt.Errorf("密钥文件损坏，请从备份恢复或重新配置凭据: %s", keyPath)
		}
		return decoded, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("读取密钥失败: %w", err)
	}

	// 生成新密钥
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("生成密钥失败: %w", err)
	}

	// Restrict the config directory so secret.key is not in a world-traversable path.
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建密钥目录失败: %w", err)
	}
	_ = os.Chmod(configDir, 0o700)

	encoded := base64.StdEncoding.EncodeToString(key)
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("保存密钥失败: %w", err)
	}
	if _, err := file.WriteString(encoded); err != nil {
		_ = file.Close()
		_ = os.Remove(keyPath)
		return nil, fmt.Errorf("保存密钥失败: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(keyPath)
		return nil, fmt.Errorf("保存密钥失败: %w", err)
	}

	return key, nil
}

// InitKey 初始化全局加密密钥，应在应用启动时调用
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
		return nil, fmt.Errorf("创建加密器失败: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("创建 GCM 失败: %w", err)
	}
	return gcm, nil
}

// Encrypt 加密明文字符串，返回带前缀的 Base64 密文
// 空字符串不加密，直接返回空字符串
func Encrypt(plaintext string, field string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if globalKey == nil {
		return "", errors.New("加密密钥未初始化")
	}

	key, err := deriveFieldKey(globalKey, field)
	if err != nil {
		return "", fmt.Errorf("派生字段密钥失败: %w", err)
	}

	gcm, err := openGCM(key)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("生成 nonce 失败: %w", err)
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
		return "", errors.New("密文数据过短")
	}
	nonce, sealed := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败: %w", err)
	}
	return string(plaintext), nil
}

// Decrypt 解密密文字符串
// 如果不是加密格式（无 ENC: 前缀），视为明文直接返回（兼容旧数据）
func Decrypt(ciphertext string, field string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	if !strings.HasPrefix(ciphertext, encryptedPrefix) {
		// 兼容未加密的旧数据
		return ciphertext, nil
	}
	if globalKey == nil {
		return "", errors.New("加密密钥未初始化")
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptedPrefix):])
	if err != nil {
		return "", fmt.Errorf("解码密文失败: %w", err)
	}

	// Prefer HKDF; fall back to legacy SHA-256(master||field) for existing installs.
	if key, err := deriveFieldKey(globalKey, field); err == nil {
		if plain, err := decryptWithKey(data, key); err == nil {
			return plain, nil
		}
	}
	return decryptWithKey(data, deriveFieldKeyLegacy(globalKey, field))
}

// IsEncrypted 判断字符串是否已加密
func IsEncrypted(s string) bool {
	return strings.HasPrefix(s, encryptedPrefix)
}
