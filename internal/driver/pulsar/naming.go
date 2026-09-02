package pulsar

import (
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

// How a Pulsar name is carried in the canonical refs.
//
// A Pulsar topic is four parts - persistence, tenant, namespace and a short
// name - written persistent://tenant/namespace/name. DestinationRef has two
// fields, so the split has to be chosen rather than derived:
//
//   - Ref.Namespace holds "tenant/namespace". They travel together everywhere
//     in Pulsar's own API, and no page ever scopes to a tenant without also
//     naming a namespace.
//   - Ref.Name holds the short name, which is what a list column shows.
//   - Persistence rides in the destination's attributes, because it is a
//     property of the topic and not part of its address within a namespace.
//
// The short name is the one part that may contain a slash. Reassembling with
// Sprintf is therefore safe, and splitting a full URL has to take the tenant
// and namespace off the front rather than cutting on the last separator.
const (
	persistentScheme    = "persistent"
	nonPersistentScheme = "non-persistent"
)

// topicURL is the address the admin API and the client both take.
func topicURL(ref model.DestinationRef, persistent bool) string {
	return fmt.Sprintf("%s://%s/%s", schemeOf(persistent), ref.Namespace, ref.Name)
}

func schemeOf(persistent bool) string {
	if persistent {
		return persistentScheme
	}
	return nonPersistentScheme
}

// parseTopicURL splits a full topic address back into a ref.
//
// It cuts the tenant and namespace off the front rather than splitting on the
// last slash, because a topic short name is allowed to contain one and the
// naive split would silently move part of the name into the namespace.
func parseTopicURL(raw string) (ref model.DestinationRef, persistent bool, err error) {
	scheme, rest, found := strings.Cut(raw, "://")
	if !found {
		return model.DestinationRef{}, false, fmt.Errorf("topic %q carries no scheme", raw)
	}
	switch scheme {
	case persistentScheme:
		persistent = true
	case nonPersistentScheme:
		persistent = false
	default:
		return model.DestinationRef{}, false, fmt.Errorf(
			"topic %q has an unknown scheme %q", raw, scheme)
	}

	tenant, afterTenant, found := strings.Cut(rest, "/")
	if !found {
		return model.DestinationRef{}, false, fmt.Errorf("topic %q names no namespace", raw)
	}
	namespace, name, found := strings.Cut(afterTenant, "/")
	if !found || name == "" {
		return model.DestinationRef{}, false, fmt.Errorf("topic %q names no topic", raw)
	}
	return model.DestinationRef{Namespace: tenant + "/" + namespace, Name: name}, persistent, nil
}

// How a subscription is carried.
//
// A Pulsar subscription has no identity apart from its topic: two topics may
// each have one called "shared", and they are unrelated. SubscriptionRef's two
// fields are spent accordingly - the whole topic URL in Namespace, the
// subscription name in Name - which is why the consumers page reads a
// subscription's topic out of the ref rather than out of an attribute.
func subscriptionRef(topic, subscription string) model.SubscriptionRef {
	return model.SubscriptionRef{Namespace: topic, Name: subscription}
}

// subscriptionTopic is the topic a subscription ref points at.
func subscriptionTopic(ref model.SubscriptionRef) (string, error) {
	if ref.Namespace == "" {
		return "", fmt.Errorf("subscription %q names no topic", ref.Name)
	}
	return ref.Namespace, nil
}

// namespaceScope is the "tenant/namespace" a filter asks for, falling back to
// the profile's own when the page has not narrowed it.
func (c *Conn) namespaceScope(namespace string) string {
	if trimmed := strings.TrimSpace(namespace); trimmed != "" {
		return trimmed
	}
	return c.config.scope()
}
