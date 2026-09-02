package resource

import "strings"

// How RocketMQ composes a namespaced resource name. A namespace is a naming
// convention rather than a broker object: the client puts the namespace in
// front of the name and the broker stores an ordinary topic or group. See
// NamespaceUtil and MixAll in apache/rocketmq.
const (
	separator   = "%"
	retryPrefix = "%RETRY%"
	dlqPrefix   = "%DLQ%"
)

// Wrap puts a resource inside a namespace, the way every RocketMQ client does:
//
//	Wrap("ns", "orders")      -> "ns%orders"
//	Wrap("ns", "%RETRY%GID_a") -> "%RETRY%ns%GID_a"
//
// An empty namespace, a system resource and a name already in the namespace all
// come back untouched.
func Wrap(namespace, name string) string {
	if namespace == "" || name == "" || isSystemResource(name) || In(namespace, name) {
		return name
	}
	prefix, bare := splitRetryPrefix(name)
	return prefix + namespace + separator + bare
}

// Unwrap is Wrap's inverse, and strips only a prefix that is actually this
// namespace's.
//
// RocketMQ allows '%' inside a topic name (^[%|a-zA-Z0-9_-]+$), so cutting at
// whichever '%' comes first - what the clients do when they unwrap blind -
// mangles a name that merely contains one. Knowing the namespace avoids the
// guess entirely.
func Unwrap(namespace, name string) string {
	if namespace == "" || !In(namespace, name) {
		return name
	}
	prefix, bare := splitRetryPrefix(name)
	return prefix + strings.TrimPrefix(bare, namespace+separator)
}

// In reports whether a broker-real name belongs to the namespace.
//
// System resources belong to every namespace: a namespaced client still writes
// to TBW102 and reads SCHEDULE_TOPIC_XXXX under their bare names. An empty
// namespace owns everything, which is what turns the filter off for a
// connection that has none.
func In(namespace, name string) bool {
	if namespace == "" {
		return true
	}
	if name == "" {
		return false
	}
	if isSystemResource(name) {
		return true
	}
	_, bare := splitRetryPrefix(name)
	return strings.HasPrefix(bare, namespace+separator)
}

// Of returns the namespace a broker-real name carries, or "" for a bare or
// system name. It reads the first separator, which is what RocketMQ's own
// getNamespaceFromResource does.
func Of(name string) string {
	if name == "" || isSystemResource(name) {
		return ""
	}
	_, bare := splitRetryPrefix(name)
	if index := strings.Index(bare, separator); index > 0 {
		return bare[:index]
	}
	return ""
}

// splitRetryPrefix separates a retry or dead-letter marker from the name it
// decorates, because the namespace goes after the marker and not in front of
// it: a namespaced group's retry topic is "%RETRY%ns%GID", not "ns%%RETRY%GID".
//
// Only the two spellings RocketMQ itself produces count here. IsSystemTopic
// also tolerates "RETRY%" and "DLQ%" without the leading percent, but that is
// leniency about what to display; what goes on the wire has to match the Java
// client exactly.
func splitRetryPrefix(name string) (prefix, bare string) {
	switch {
	case strings.HasPrefix(name, retryPrefix):
		return retryPrefix, name[len(retryPrefix):]
	case strings.HasPrefix(name, dlqPrefix):
		return dlqPrefix, name[len(dlqPrefix):]
	default:
		return "", name
	}
}

// isSystemResource reports what RocketMQ's NamespaceUtil refuses to wrap:
// TopicValidator.isSystemTopic or MixAll.isSysConsumerGroup.
//
// Deliberately not IsSystemTopic, which is this app's broader "hide it from the
// list" rule. The two answer different questions and must be allowed to differ:
// if this one drifted wider we would ask the broker for "ns%TBW102" where a
// real client asks for "TBW102".
func isSystemResource(name string) bool {
	if _, ok := systemTopics[name]; ok {
		return true
	}
	// Case-sensitive, as in TopicValidator: the upper-case RMQ_SYS_ names are
	// carried by the set above, not by this prefix.
	return strings.HasPrefix(name, "rmq_sys_") || strings.HasPrefix(name, "CID_RMQ_SYS_")
}

// systemTopics is TopicValidator.SYSTEM_TOPIC_SET.
var systemTopics = map[string]struct{}{
	"TBW102":                              {},
	"SCHEDULE_TOPIC_XXXX":                 {},
	"BenchmarkTest":                       {},
	"RMQ_SYS_TRANS_HALF_TOPIC":            {},
	"RMQ_SYS_TRACE_TOPIC":                 {},
	"RMQ_SYS_TRANS_OP_HALF_TOPIC":         {},
	"TRANS_CHECK_MAX_TIME_TOPIC":          {},
	"SELF_TEST_TOPIC":                     {},
	"OFFSET_MOVED_EVENT":                  {},
	"CHECKPOINT_TOPIC":                    {},
	"RMQ_SYS_ROCKSDB_TRANS_HALF_TOPIC":    {},
	"RMQ_SYS_ROCKSDB_TRANS_OP_HALF_TOPIC": {},
}
