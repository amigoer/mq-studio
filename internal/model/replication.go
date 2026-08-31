package model

// Shovel moves messages from one broker to another, or between two places on
// the same one.
//
// It is a plugin rather than core RabbitMQ, which is why the capability can be
// degraded: a stock broker has none, and that is a deployment choice rather
// than a failure.
type Shovel struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// State is what the broker reports it is doing - running, starting,
	// terminated. Empty means it reported nothing, which itself says the
	// shovel is defined and has not started.
	State string `json:"state"`
	// Type is dynamic or static: a static shovel comes from the broker's
	// config file and cannot be deleted from here.
	Type  string `json:"type"`
	Since string `json:"since"`

	// Source and Target say what it moves, in words - one of a queue or an
	// exchange at each end, never both.
	Source string `json:"source"`
	Target string `json:"target"`

	AckMode string `json:"ackMode"`
	// SourceURI and TargetURI have their passwords removed. They are the one
	// place the management API stores another broker's credential in plain
	// text and hands it back on request.
	SourceURI []string `json:"sourceUri"`
	TargetURI []string `json:"targetUri"`
}

// FederationUpstream is another broker this one pulls from.
//
// Different from a shovel in what it is for: a shovel moves messages once,
// from somewhere to somewhere; federation keeps two brokers' exchanges or
// queues in step continuously.
type FederationUpstream struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// URI has its password removed.
	URI []string `json:"uri"`

	// Exchange and Queue are which of the two this upstream federates, and
	// exactly one of them is set.
	Exchange string `json:"exchange"`
	Queue    string `json:"queue"`
	// MaxHops stops a federation loop between brokers from carrying a message
	// forever.
	MaxHops int    `json:"maxHops"`
	AckMode string `json:"ackMode"`

	// State is the running link's status, and Error is why it is not running.
	// An upstream is configuration; a link is a connection that either works
	// or explains itself.
	State string `json:"state"`
	Error string `json:"error"`
}
