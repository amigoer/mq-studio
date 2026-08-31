package model

// Policy applies settings to every destination whose name matches a pattern.
//
// It is the answer to something RabbitMQ otherwise cannot do: a queue's
// arguments are fixed at declaration, so the only way to change a live queue's
// TTL, length limit or dead-letter exchange is a policy matching it. That
// makes this page the edit form the queue page does not have.
//
// Only one policy applies to a given queue - the highest priority that matches
// - which is the rule most people get wrong. Policies do not merge.
type Policy struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// Pattern is a regular expression matched against the destination's name.
	Pattern string `json:"pattern"`
	// ApplyTo is "queues", "exchanges", "classic_queues", "quorum_queues",
	// "streams" or "all".
	ApplyTo string `json:"applyTo"`
	// Priority breaks ties. Higher wins, and only the winner applies.
	Priority int `json:"priority"`
	// Definition is the settings applied, as JSON so the types survive.
	Definition string `json:"definition"`
	// Operator marks a policy set by the operator rather than the user. The
	// broker applies both, and where they set the same key the operator's more
	// restrictive value wins - which is the point of them.
	Operator bool `json:"operator"`
}

// RuntimeParameter is a component's configuration, kept by the broker rather
// than in a file.
//
// Shovels and federation upstreams are stored as these, which is why the page
// shows them: a parameter with an unfamiliar component name is usually a
// plugin's configuration, and being able to see it is the difference between
// diagnosing one and guessing.
type RuntimeParameter struct {
	Component string `json:"component"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// Value is JSON, because a parameter's shape is defined by whichever
	// plugin owns the component and this app cannot know it.
	Value string `json:"value"`
}
