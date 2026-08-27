package connection

import (
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/rocketmq"
)

// normalizeConnectionGroup trims a group label and collapses inner whitespace.
// The label is free-form, so an empty result is valid and means "ungrouped".
func normalizeConnectionGroup(group string) string {
	return strings.Join(strings.Fields(group), " ")
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
