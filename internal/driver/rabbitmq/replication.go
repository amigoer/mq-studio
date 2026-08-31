package rabbitmq

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// ListShovels returns every shovel with the state the broker reports for it.
//
// Two calls, because the broker keeps them apart: a shovel's definition is a
// runtime parameter, and its state is transient. The difference matters - a
// shovel can be perfectly defined and permanently failing to connect, and only
// the second says so.
//
// The status comes first because it is also the proof the plugin is loaded. A
// definition lives in the parameter store, which is core, so a broker with no
// shovel plugin answers that call with an empty list - and "no shovels are
// configured" is the wrong thing to tell someone whose shovels are simply not
// being run.
func (c *Conn) ListShovels(ctx context.Context) ([]*model.Shovel, error) {
	reported, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ShovelStatus, error) {
		return client.ListShovelStatus("")
	})
	if err != nil {
		return nil, fmt.Errorf("list shovels: %w", err)
	}
	states := map[string]rabbithole.ShovelStatus{}
	for _, status := range reported {
		states[status.Vhost+"/"+status.Name] = status
	}

	defined, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ShovelInfo, error) {
		return client.ListShovels()
	})
	if err != nil {
		return nil, fmt.Errorf("list shovels: %w", err)
	}

	shovels := make([]*model.Shovel, 0, len(defined))
	for i := range defined {
		shovel := &defined[i]
		status := states[shovel.Vhost+"/"+shovel.Name]
		shovels = append(shovels, &model.Shovel{
			Namespace: shovel.Vhost,
			Name:      shovel.Name,
			// State is empty when the broker reports none, which is itself
			// worth showing: a defined shovel with no state has not started.
			State:     status.State,
			Type:      status.Type,
			Since:     shovelTimestamp(status.Timestamp),
			Source:    shovelSource(&shovel.Definition),
			Target:    shovelTarget(&shovel.Definition),
			AckMode:   shovel.Definition.AckMode,
			SourceURI: redactURIs(shovel.Definition.SourceURI),
			TargetURI: redactURIs(shovel.Definition.DestinationURI),
		})
	}
	return shovels, nil
}

// RemoveShovel deletes a shovel, stopping it.
func (c *Conn) RemoveShovel(ctx context.Context, namespace, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteShovel(namespace, name)
	})
	if err != nil {
		return fmt.Errorf("delete shovel %q: %w", name, err)
	}
	return nil
}

// ListFederationUpstreams returns the brokers this one federates from.
func (c *Conn) ListFederationUpstreams(ctx context.Context) ([]*model.FederationUpstream, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.FederationUpstream, error) {
		return client.ListFederationUpstreams()
	})
	if err != nil {
		return nil, fmt.Errorf("list federation upstreams: %w", err)
	}

	// Links are the running half: an upstream is configuration, a link is a
	// connection that is either up or explaining why it is not.
	//
	// The library hands these back as untyped maps rather than a struct,
	// because the shape depends on which federation plugins are on, so the two
	// fields the page needs are read out by name.
	links := map[string]map[string]interface{}{}
	if running, linkErr := call(ctx, c.mgmt, func(client *rabbithole.Client) (rabbithole.FederationLinkMap, error) {
		return client.ListFederationLinks()
	}); linkErr == nil {
		for _, link := range running {
			key := linkString(link, "vhost") + "/" + linkString(link, "upstream")
			links[key] = link
		}
	}

	upstreams := make([]*model.FederationUpstream, 0, len(found))
	for i := range found {
		upstream := &found[i]
		link := links[upstream.Vhost+"/"+upstream.Name]
		upstreams = append(upstreams, &model.FederationUpstream{
			Namespace: upstream.Vhost,
			Name:      upstream.Name,
			URI:       redactURIs(upstream.Definition.Uri),
			Exchange:  upstream.Definition.Exchange,
			Queue:     upstream.Definition.Queue,
			MaxHops:   upstream.Definition.MaxHops,
			AckMode:   upstream.Definition.AckMode,
			State:     linkString(link, "status"),
			Error:     linkString(link, "error"),
		})
	}
	return upstreams, nil
}

// RemoveFederationUpstream deletes an upstream, stopping its links.
func (c *Conn) RemoveFederationUpstream(ctx context.Context, namespace, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteFederationUpstream(namespace, name)
	})
	if err != nil {
		return fmt.Errorf("delete federation upstream %q: %w", name, err)
	}
	return nil
}

/*
 * shovelTimestamp turns the broker's own format into one that carries its zone.
 *
 * The status endpoint reports UTC as "2026-08-31 4:15:18" - no marker, and a
 * single-digit hour. Passed through as it stood, it was drawn beside times the
 * app had rendered in the reader's own zone, so a reader eight hours from UTC
 * read it as eight hours wrong. Re-emitted with the zone, the renderer can put
 * it in their timezone like every other timestamp.
 *
 * A format this cannot read is passed through: a wrong-looking timestamp is
 * better than no timestamp.
 */
func shovelTimestamp(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := time.Parse("2006-1-2 15:4:5", raw)
	if err != nil {
		return raw
	}
	return parsed.UTC().Format(time.RFC3339)
}

// linkString reads one field out of a federation link, which the library
// leaves untyped.
func linkString(link map[string]interface{}, field string) string {
	value, present := link[field]
	if !present || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

// shovelSource and shovelTarget say what a shovel actually moves, which is one
// of a queue or an exchange at each end and never both.
func shovelSource(definition *rabbithole.ShovelDefinition) string {
	if definition.SourceQueue != "" {
		return "queue " + definition.SourceQueue
	}
	if definition.SourceExchange != "" {
		return "exchange " + definition.SourceExchange
	}
	return definition.SourceAddress
}

func shovelTarget(definition *rabbithole.ShovelDefinition) string {
	if definition.DestinationQueue != "" {
		return "queue " + definition.DestinationQueue
	}
	if definition.DestinationExchange != "" {
		return "exchange " + definition.DestinationExchange
	}
	return definition.DestinationAddress
}

// redactURIs strips the credentials out of a shovel or upstream URI.
//
// These are the one place in the whole management API where another broker's
// password is stored in plain text and handed back on request. Showing the
// host is what an operator needs; showing the password would put it in a
// screenshot.
func redactURIs(uris rabbithole.URISet) []string {
	redacted := make([]string, 0, len(uris))
	for _, raw := range uris {
		redacted = append(redacted, redactURI(raw))
	}
	return redacted
}

func redactURI(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		// Unparsable, so nothing can be said about which part is the
		// credential. Everything before an @ goes.
		if at := strings.LastIndex(raw, "@"); at >= 0 {
			return "***@" + raw[at+1:]
		}
		return raw
	}
	if parsed.User != nil {
		parsed.User = url.User(parsed.User.Username())
		return strings.Replace(parsed.String(), parsed.User.Username()+"@",
			parsed.User.Username()+":***@", 1)
	}
	return parsed.String()
}

// hasReplicationPlugins reports whether the broker can answer about either
// half of this page. A 404 means the plugin is off, which is a deployment
// choice rather than a failure.
//
// Checked once at connect rather than per page load, so the sidebar can say
// "this needs a plugin" instead of the page failing when someone opens it.
//
// Deliberately not the definition endpoints: a shovel is stored as a runtime
// parameter, and /api/parameters/shovel answers on a broker with no shovel
// plugin at all because the parameter store is core. Only the plugins' own
// endpoints - the shovel status and the federation links - 404 when they are
// absent, which is what has to be asked.
//
// Either one is enough. They are two independent plugins, and a broker with
// one of them has a page worth opening.
func (c *Conn) hasReplicationPlugins(ctx context.Context) error {
	_, shovelErr := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ShovelStatus, error) {
		return client.ListShovelStatus("")
	})
	if shovelErr == nil {
		return nil
	}
	_, federationErr := call(ctx, c.mgmt, func(client *rabbithole.Client) (rabbithole.FederationLinkMap, error) {
		return client.ListFederationLinks()
	})
	if federationErr == nil {
		return nil
	}
	return shovelErr
}
