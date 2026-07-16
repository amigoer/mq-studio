// Package resource classifies RocketMQ system resources hidden from normal views.
package resource

import "strings"

// IsSystemTopic reports whether a topic is internal and hidden from the default
// list. Retry and dead-letter topics remain visible for operational use.
func IsSystemTopic(topic string) bool {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return true
	}

	// Retry and dead-letter queues are business-related and remain visible.
	if strings.HasPrefix(topic, "%RETRY%") ||
		strings.HasPrefix(topic, "%DLQ%") ||
		strings.HasPrefix(topic, "RETRY%") ||
		strings.HasPrefix(topic, "DLQ%") {
		return false
	}

	// Other names with a percent prefix are internal.
	if topic[0] == '%' {
		return true
	}

	lower := strings.ToLower(topic)
	upper := strings.ToUpper(topic)

	switch {
	case strings.HasPrefix(upper, "RMQ_SYS_"),
		strings.HasPrefix(lower, "rmq_sys_"),
		strings.HasPrefix(upper, "SCHEDULE_TOPIC"),
		strings.HasPrefix(topic, "DefaultHeartBeat"),
		strings.Contains(upper, "_REPLY_TOPIC"),
		strings.HasSuffix(upper, "REPLY_TOPIC"),
		strings.Contains(upper, "WHEEL_TIMER"),
		strings.Contains(upper, "REVIVE_LOG"),
		strings.Contains(upper, "SYNC_BROKER_MEMBER"),
		strings.Contains(upper, "ROCKSDB"),
		strings.Contains(upper, "TRANS_HALF"),
		strings.Contains(upper, "TRANS_OP_HALF"):
		return true
	}

	exact := map[string]struct{}{
		"SCHEDULE_TOPIC_XXXX":         {},
		"RMQ_SYS_TRANS_HALF_TOPIC":    {},
		"RMQ_SYS_TRACE_TOPIC":         {},
		"RMQ_SYS_TRANS_OP_HALF_TOPIC": {},
		"TRANS_CHECK_MAX_TIME_TOPIC":  {},
		"SELF_TEST_TOPIC":             {},
		"TBW102":                      {},
		"BenchmarkTest":               {},
		"DefaultCluster":              {},
		"OFFSET_MOVED_EVENT":          {},
		"DefaultHeartBeatSyncerTopic": {},
	}
	_, ok := exact[topic]
	return ok
}

// IsSystemGroup reports whether a consumer group is reserved for system use.
func IsSystemGroup(group string) bool {
	systemGroups := []string{
		"CID_ONSAPI_OWNER",
		"CID_ONSAPI_PERMISSION",
		"CID_ONSAPI_PULL",
		"CID_RMQ_SYS_TRANS",
		"TOOLS_CONSUMER",
		"FILTERSRV_CONSUMER",
		"__MONITOR_CONSUMER",
		"CLIENT_INNER_PRODUCER",
		"SELF_TEST_C_GROUP",
		"SELF_TEST_P_GROUP",
		"CID_RMQ_SYS_TRACE",
	}

	for _, systemGroup := range systemGroups {
		if group == systemGroup {
			return true
		}
	}

	return len(group) > 10 && group[:10] == "CID_ONSAPI"
}
