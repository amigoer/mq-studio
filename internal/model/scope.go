package model

// Scope is one value a connection's scope can be pointed at.
//
// Distinct from Namespace, which is a broker object carrying its own settings,
// limits and permissions. A scope is a naming convention - a RocketMQ
// namespace is a prefix the client puts in front of every resource it names -
// so nothing creates one, nothing removes one, and the only evidence one
// exists is that some topic or group carries it. The counts are therefore not
// decoration: they are the whole answer to whether a name means anything on
// this cluster.
type Scope struct {
	Name string `json:"name"`
	// Destinations and Subscriptions are how many of each carry the name.
	Destinations  int `json:"destinations"`
	Subscriptions int `json:"subscriptions"`
}
