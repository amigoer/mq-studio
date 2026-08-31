package model

// Identity is a principal the broker authenticates.
//
// It is not AccessConfig and not AccessPrincipal. RocketMQ's plain_acl entry
// carries a key, a secret and its permissions together, and 5.3's auth store
// keeps rules attached to a subject; RabbitMQ keeps a user with tags in one
// place and its per-virtual-host permissions in another, and the tags decide
// what the management API lets it do while the permissions decide what its
// AMQP connections may touch. Those are two different systems on one name, and
// flattening them would lose which one is refusing an operation.
type Identity struct {
	Name string `json:"name"`
	// Tags gate the management API: administrator, monitoring, policymaker,
	// management. They have nothing to do with the permissions below - a user
	// with every tag and no permission can read every page and touch no queue.
	Tags []string `json:"tags"`
	// HasPassword is false for a user that can only authenticate another way,
	// which is a deliberate configuration rather than a broken one. The
	// password itself never comes back.
	HasPassword bool `json:"hasPassword"`

	// Permissions is what this identity may do inside each namespace.
	Permissions []*NamespacePermission `json:"permissions"`
}

// NamespacePermission is one identity's rights inside one namespace.
//
// The three fields are regular expressions matched against a resource's name,
// and the distinction between an empty one and ".*" is the whole model: empty
// matches nothing and permits nothing, ".*" matches everything. A page that
// rendered an empty pattern as "none set" would be describing the opposite of
// what it does.
type NamespacePermission struct {
	Namespace string `json:"namespace"`
	Identity  string `json:"identity"`
	// Configure is declaring and deleting queues and exchanges.
	Configure string `json:"configure"`
	// Write is publishing to an exchange, and binding.
	Write string `json:"write"`
	// Read is consuming from a queue, and binding.
	Read string `json:"read"`
}

// TopicPermission narrows write and read further, for topic exchanges only.
//
// Separate from NamespacePermission because it is a separate endpoint and
// because it does nothing on its own: it is a filter applied on top of the
// permissions above, and a user with no write permission gains none from a
// topic permission that would allow it.
type TopicPermission struct {
	Namespace string `json:"namespace"`
	Identity  string `json:"identity"`
	// Exchange is which topic exchange this applies to.
	Exchange string `json:"exchange"`
	Write    string `json:"write"`
	Read     string `json:"read"`
}

// IdentitySpec creates or updates an identity.
type IdentitySpec struct {
	Name string   `json:"name"`
	Tags []string `json:"tags"`
	// Password sets a new one. Empty means leave whatever is stored alone,
	// which is what lets tags be edited without knowing it.
	Password string `json:"password"`
	// WithoutPassword asks for an identity that cannot authenticate with one
	// at all - correct for certificate or OAuth authentication.
	//
	// It is a separate flag rather than an empty password because the two are
	// opposite instructions and the broker has no way to express "keep it":
	// its update endpoint replaces the whole user, so leaving the field out
	// removes the password rather than preserving it.
	WithoutPassword bool `json:"withoutPassword"`
}
