package message

import (
	"encoding/json"
	"fmt"
	"strings"
)

func containsExactMessageKey(rawKeys, wanted string) bool {
	for _, key := range strings.Fields(rawKeys) {
		if key == wanted {
			return true
		}
	}
	return false
}

func matchesMessageQueueKey(key, topic, brokerName string, queueID int) bool {
	var parsed struct {
		Topic      string `json:"topic"`
		BrokerName string `json:"brokerName"`
		QueueID    int    `json:"queueId"`
	}
	if json.Unmarshal([]byte(key), &parsed) == nil && parsed.Topic != "" {
		return parsed.Topic == topic && parsed.QueueID == queueID &&
			(brokerName == "" || parsed.BrokerName == brokerName)
	}
	if strings.Contains(key, "topic=") {
		return extractQueueKeyField(key, "topic") == topic &&
			extractQueueKeyField(key, "queueId") == fmt.Sprintf("%d", queueID) &&
			(brokerName == "" || extractQueueKeyField(key, "brokerName") == brokerName)
	}
	queueSuffix := fmt.Sprintf("-%d", queueID)
	if brokerName == "" {
		return strings.HasPrefix(key, topic+"-") && strings.HasSuffix(key, queueSuffix)
	}
	return key == fmt.Sprintf("%s-%s-%d", topic, brokerName, queueID)
}

func extractQueueKeyField(key, field string) string {
	marker := field + "="
	index := strings.Index(key, marker)
	if index < 0 {
		return ""
	}
	value := key[index+len(marker):]
	if end := strings.IndexAny(value, ",]"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}
