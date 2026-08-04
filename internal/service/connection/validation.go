package connection

import (
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/rocketmq"
)

// normalizeConnectionEnv accepts current values and legacy Chinese values.
func normalizeConnectionEnv(env model.ConnectionEnv) model.ConnectionEnv {
	switch strings.TrimSpace(string(env)) {
	case "production", "生产":
		return model.EnvProduction
	case "test", "测试":
		return model.EnvTest
	case "development", "开发":
		return model.EnvDevelopment
	default:
		return model.EnvDevelopment
	}
}

func normalizeACLConfig(enableACL bool, accessKey, secretKey string) (bool, string, string, error) {
	accessKey = strings.TrimSpace(accessKey)
	secretKey = strings.TrimSpace(secretKey)
	if !enableACL {
		return false, "", "", nil
	}
	if accessKey == "" {
		return false, "", "", fmt.Errorf("AccessKey is required when ACL is enabled")
	}
	if secretKey == "" {
		return false, "", "", fmt.Errorf("SecretKey is required when ACL is enabled")
	}
	return true, accessKey, secretKey, nil
}

func normalizeTimeoutSec(timeoutSec int) int {
	if timeoutSec <= 0 {
		return defaultConnectionTimeout
	}
	return timeoutSec
}

func validateConnectionFields(name, nameServer string, timeoutSec int) (string, string, error) {
	name = strings.TrimSpace(name)
	nameServer = strings.TrimSpace(nameServer)
	if name == "" {
		return "", "", fmt.Errorf("connection name cannot be empty")
	}
	if len(rocketmq.ParseNameServers(nameServer)) == 0 {
		return "", "", fmt.Errorf("NameServer address cannot be empty")
	}
	if timeoutSec < 0 || timeoutSec > 300 {
		return "", "", fmt.Errorf("connection timeout must be between 1 and 300 seconds")
	}
	return name, nameServer, nil
}
