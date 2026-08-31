package rabbitmq

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// ExportDefinitions returns the broker's whole topology as JSON.
//
// Everything except the messages: virtual hosts, users and their permissions,
// queues, exchanges, bindings, policies and parameters. It is what a cluster
// is rebuilt from, and it is the only backup RabbitMQ offers of anything but
// message data.
//
// Scoped to one virtual host when asked, which is the useful scope in practice
// - a whole-broker export carries every user's password hash, and moving one
// application's topology between environments does not need them.
func (c *Conn) ExportDefinitions(ctx context.Context, namespace string) (*model.Definitions, error) {
	exported, err := call(ctx, c.mgmt, func(client *rabbithole.Client) (*rabbithole.ExportedDefinitions, error) {
		if namespace == "" {
			return client.ListDefinitions()
		}
		return client.ListVhostDefinitions(namespace)
	})
	if err != nil {
		return nil, fmt.Errorf("export definitions: %w", err)
	}

	document, err := json.MarshalIndent(exported, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode definitions: %w", err)
	}
	return &model.Definitions{
		Namespace: namespace,
		Document:  string(document),
		Counts:    countDefinitions(exported),
	}, nil
}

// ImportDefinitions applies a definitions document.
//
// It is additive and destructive at once, which is why the page warns rather
// than the driver: anything named in the document is created or overwritten,
// and anything on the broker the document does not mention is left alone. So
// it cannot be used to make a cluster match a file - only to put the file's
// contents into it.
func (c *Conn) ImportDefinitions(ctx context.Context, namespace, document string) error {
	var definitions rabbithole.ExportedDefinitions
	if err := json.Unmarshal([]byte(document), &definitions); err != nil {
		return fmt.Errorf("the definitions document is not valid JSON: %w", err)
	}

	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		if namespace == "" {
			return client.UploadDefinitions(&definitions)
		}
		return client.UploadVhostDefinitions(&definitions, namespace)
	})
	if err != nil {
		return fmt.Errorf("import definitions: %w", err)
	}
	return nil
}

// SummariseDefinitions counts what a document contains without applying it.
//
// It is what the import step shows before asking to go ahead: the file is
// opaque otherwise, and "this will create fourteen queues and three users" is
// the only check anyone can actually perform on one.
func SummariseDefinitions(document string) (map[string]int, error) {
	var definitions rabbithole.ExportedDefinitions
	if err := json.Unmarshal([]byte(document), &definitions); err != nil {
		return nil, fmt.Errorf("the definitions document is not valid JSON: %w", err)
	}
	return countDefinitions(&definitions), nil
}

// countDefinitions counts each kind, treating an absent section as zero.
//
// Every section is a pointer in the library's shape, and a whole-broker export
// carries sections a single-vhost one does not - users and permissions are
// broker-wide, so a per-vhost document has none, and that is an absence rather
// than an empty list.
func countDefinitions(definitions *rabbithole.ExportedDefinitions) map[string]int {
	return map[string]int{
		model.DefinitionVhosts:      countOf(definitions.Vhosts),
		model.DefinitionUsers:       countOf(definitions.Users),
		model.DefinitionPermissions: countOf(definitions.Permissions),
		model.DefinitionQueues:      countOf(definitions.Queues),
		model.DefinitionExchanges:   countOf(definitions.Exchanges),
		model.DefinitionBindings:    countOf(definitions.Bindings),
		model.DefinitionPolicies:    countOf(definitions.Policies),
		model.DefinitionParameters:  countOf(definitions.Parameters),
	}
}

func countOf[T any](section *[]T) int {
	if section == nil {
		return 0
	}
	return len(*section)
}
