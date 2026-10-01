package toolset

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * A namespace the family does not keep destinations apart by is dropped by its
 * driver, and the answer comes back from the connection's own scope - which
 * reads exactly like the namespace's contents. NATS invites it: it lists
 * accounts, and no stream call takes one.
 *
 * What came back says which happened. A family that scopes by namespace puts
 * the one it answered from on every ref - a RabbitMQ vhost, a Pulsar
 * tenant/namespace, a RocketMQ cluster - so the answer is the evidence, and no
 * list of families is kept to go stale. An empty answer carries none and is
 * let through.
 */
func consulted(kind model.MQKind, requested string, answered ...string) error {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return nil
	}
	for _, namespace := range answered {
		if namespace == requested {
			continue
		}
		if namespace == "" {
			return fmt.Errorf("%s does not keep these apart by namespace, so %q was not consulted",
				kind, requested)
		}
		return fmt.Errorf("%s answered from %q rather than %q, so the namespace was not consulted",
			kind, namespace, requested)
	}
	return nil
}

// resolvedIn confirms that the family finds a destination inside the namespace
// named, before anything irreversible is done to it. Afterwards is too late:
// the connection's own destination of the same name is what would have gone.
func (e *Env) resolvedIn(ctx context.Context, connID int, kind model.MQKind, ref model.DestinationRef) error {
	if strings.TrimSpace(ref.Namespace) == "" {
		return nil
	}
	destination, err := e.Services.Topics.Detail(ctx, connID, ref)
	if err != nil {
		return fmt.Errorf("could not confirm %s is in %q: %w", ref.Name, ref.Namespace, err)
	}
	if destination == nil {
		return fmt.Errorf("could not confirm %s is in %q: %s returned nothing", ref.Name, ref.Namespace, kind)
	}
	return consulted(kind, ref.Namespace, destination.Ref.Namespace)
}
