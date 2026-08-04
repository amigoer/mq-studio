package topic

import (
	"encoding/json"
	"fmt"
	"strings"
)

// parseMQKey extracts the broker name and queue ID from a serialized MessageQueue.
func parseMQKey(key string) (string, int) {
	var parsed struct {
		BrokerName string `json:"brokerName"`
		QueueID    int    `json:"queueId"`
	}
	if json.Unmarshal([]byte(key), &parsed) == nil && parsed.BrokerName != "" {
		return parsed.BrokerName, parsed.QueueID
	}

	brokerName := ""
	queueID := 0
	if index := strings.Index(key, "brokerName="); index >= 0 {
		value := key[index+len("brokerName="):]
		if end := strings.IndexAny(value, ",]"); end >= 0 {
			brokerName = strings.TrimSpace(value[:end])
		}
	}
	if index := strings.Index(key, "queueId="); index >= 0 {
		value := key[index+len("queueId="):]
		if end := strings.IndexAny(value, ",]"); end >= 0 {
			fmt.Sscanf(strings.TrimSpace(value[:end]), "%d", &queueID)
		}
	}
	if brokerName == "" {
		parts := strings.Split(key, "-")
		if len(parts) >= 2 {
			if _, err := fmt.Sscanf(parts[len(parts)-1], "%d", &queueID); err == nil {
				brokerName = strings.Join(parts[:len(parts)-1], "-")
			}
		}
	}
	return brokerName, queueID
}
