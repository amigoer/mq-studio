package rabbitmq

import (
	"context"
	"fmt"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// The limits a virtual host can carry. They are the broker's own names, and
// the page labels them rather than inventing its own.
const (
	LimitMaxConnections = "max-connections"
	LimitMaxQueues      = "max-queues"
)

// ListNamespaces returns every virtual host, with the limits set on each.
//
// The limits come from their own endpoint and are merged in here rather than
// asked for per row: one request answers the whole page, and a vhost with no
// limits simply has none in the map - which reads differently from a limit of
// zero, and has to.
func (c *Conn) ListNamespaces(ctx context.Context) ([]*model.Namespace, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.VhostInfo, error) {
		return client.ListVhosts()
	})
	if err != nil {
		return nil, fmt.Errorf("list virtual hosts: %w", err)
	}

	limits := map[string]map[string]int{}
	// Limits are best effort: an older broker has no such endpoint, and losing
	// the whole page to that would be worse than a page with no limit column.
	if all, limitErr := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.VhostLimitsInfo, error) {
		return client.GetAllVhostLimits()
	}); limitErr == nil {
		for _, entry := range all {
			limits[entry.Vhost] = entry.Value
		}
	}

	namespaces := make([]*model.Namespace, 0, len(found))
	for i := range found {
		namespaces = append(namespaces, namespaceFrom(&found[i], limits[found[i].Name]))
	}
	return namespaces, nil
}

// CreateNamespace creates a virtual host, or updates one that exists.
//
// PUT is how the broker spells both, and it is idempotent: re-sending the same
// settings changes nothing. That is why there is no separate update - unlike a
// queue, a vhost's settings genuinely can be changed after the fact.
func (c *Conn) CreateNamespace(ctx context.Context, spec model.NamespaceSpec) error {
	settings := rabbithole.VhostSettings{
		Description:      spec.Description,
		Tags:             spec.Tags,
		DefaultQueueType: spec.DefaultQueueType,
		Tracing:          spec.Tracing,
	}
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.PutVhost(spec.Name, settings)
	})
	if err != nil {
		return fmt.Errorf("create virtual host %q: %w", spec.Name, err)
	}
	return nil
}

// RemoveNamespace deletes a virtual host and everything inside it.
//
// Everything means everything: queues, their messages, exchanges, bindings,
// policies and permissions. The broker does not ask, so the page must.
func (c *Conn) RemoveNamespace(ctx context.Context, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteVhost(name)
	})
	if err != nil {
		return fmt.Errorf("delete virtual host %q: %w", name, err)
	}
	return nil
}

// SetNamespaceLimit caps a virtual host as a whole.
func (c *Conn) SetNamespaceLimit(ctx context.Context, name, limit string, value int) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.PutVhostLimits(name, rabbithole.VhostLimitsValues{limit: value})
	})
	if err != nil {
		return fmt.Errorf("set %s on %q: %w", limit, name, err)
	}
	return nil
}

// RemoveNamespaceLimit lifts a cap.
//
// Deleting the limit is not the same as setting it to zero: zero forbids
// everything, absence allows anything, and a page that offered only a number
// would have no way to say the second.
func (c *Conn) RemoveNamespaceLimit(ctx context.Context, name, limit string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteVhostLimits(name, rabbithole.VhostLimits{limit})
	})
	if err != nil {
		return fmt.Errorf("remove %s from %q: %w", limit, name, err)
	}
	return nil
}

func namespaceFrom(vhost *rabbithole.VhostInfo, limits map[string]int) *model.Namespace {
	return &model.Namespace{
		Name:             vhost.Name,
		Description:      vhost.Description,
		Tags:             vhost.Tags,
		DefaultQueueType: vhost.DefaultQueueType,
		Tracing:          vhost.Tracing,
		Messages:         int64(vhost.Messages),
		Ready:            int64(vhost.MessagesReady),
		Unacknowledged:   int64(vhost.MessagesUnacknowledged),
		Limits:           limits,
	}
}
