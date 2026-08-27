package connection

import (
	"fmt"
	"strings"
)

// hasEndpoint reports whether raw carries at least one address.
//
// The delimiters are the endpoint-list convention every family shares -
// RocketMQ name servers, Kafka bootstrap servers - and emptiness is all this
// check needs. Anything more specific is the driver's job, which is why this
// no longer goes through the RocketMQ parser.
func hasEndpoint(raw string) bool {
	return len(strings.FieldsFunc(raw, func(r rune) bool {
		return r == ';' || r == ',' || r == ' ' || r == '\t' || r == '\r' || r == '\n'
	})) > 0
}

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
	if !hasEndpoint(nameServer) {
		return "", "", fmt.Errorf("NameServer address cannot be empty")
	}
	if timeoutSec < 0 || timeoutSec > 300 {
		return "", "", fmt.Errorf("connection timeout must be between 1 and 300 seconds")
	}
	return name, nameServer, nil
}
