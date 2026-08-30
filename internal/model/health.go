package model

// HealthCheck is one question the broker answers about itself.
//
// RabbitMQ's health endpoints are deliberately narrow: each asks one thing and
// answers ok or not, with a sentence when not. Collapsing them into a single
// "healthy" flag would throw away the only part an operator can act on, which
// is which check failed and what it said.
type HealthCheck struct {
	// ID is a stable key the UI labels from, not a sentence.
	ID string `json:"id"`
	// Passed is false when the check failed and unknown when the broker could
	// not run it at all, which is why Unavailable exists rather than a third
	// value here.
	Passed bool `json:"passed"`
	// Unavailable means this endpoint is not on this broker - an older
	// version, or a check that needs a plugin. It reads differently from a
	// failure and must not be shown as one.
	Unavailable bool   `json:"unavailable"`
	Reason      string `json:"reason"`
}

// ResourceAlarm is a node that has crossed a memory or disk watermark.
//
// While one is in effect the broker refuses publishes from every connection,
// which makes it the first thing worth showing on a cluster page.
type ResourceAlarm struct {
	Node     string `json:"node"`
	Resource string `json:"resource"`
}

// FeatureFlag is a behaviour change that has to be enabled before the cluster
// can use it, and cannot be turned off again once it is.
//
// It matters on a page about nodes because a flag that is not enabled
// everywhere blocks a rolling upgrade: the cluster cannot move to a version
// that requires it until every node agrees.
type FeatureFlag struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// State is the broker's own word - "enabled", "disabled", "unavailable".
	State      string `json:"state"`
	Stability  string `json:"stability"`
	ProvidedBy string `json:"providedBy"`
	DocURL     string `json:"docUrl"`
}

// DeprecatedFeature is something this cluster still allows that a later
// release will not.
//
// The list of what is deprecated is background; the list of what is deprecated
// *and in use here* is a work item, which is why the two are reported
// separately rather than as one list with a flag.
type DeprecatedFeature struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Phase is how far along the removal is: permitted by default, denied by
	// default, disconnected, or removed.
	Phase      string `json:"phase"`
	ProvidedBy string `json:"providedBy"`
	DocURL     string `json:"docUrl"`
	// InUse is set when the broker reports this feature is actually being
	// used on this cluster, which turns it from background into a work item.
	InUse bool `json:"inUse"`
}

// BrokerHealth is everything a cluster page asks beyond the node list.
type BrokerHealth struct {
	Checks             []*HealthCheck       `json:"checks"`
	Alarms             []*ResourceAlarm     `json:"alarms"`
	FeatureFlags       []*FeatureFlag       `json:"featureFlags"`
	DeprecatedFeatures []*DeprecatedFeature `json:"deprecatedFeatures"`
}
