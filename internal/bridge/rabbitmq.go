package bridge

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	rabbitmqdriver "github.com/amigoer/mq-studio/internal/driver/rabbitmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/rabbitmq"
)

// RabbitMQService exposes what only RabbitMQ has.
//
// It is one service rather than several because it is one family's surface:
// splitting virtual hosts, policies and the broker census into three would put
// three names in the bindings for what a reader thinks of as "the RabbitMQ
// pages".
type RabbitMQService struct {
	service *rabbitmq.Service
}

// Census returns the broker's running totals: object counts, queued depth and
// message rates for the whole cluster.
//
// Nil means nothing is connected, which the overview renders as its own state
// rather than as an error.
func (s *RabbitMQService) Census(connID int) (*model.BrokerCensus, error) {
	return s.service.Census(context.Background(), connID)
}

// ClientConnections returns the transport connections open against the broker.
func (s *RabbitMQService) ClientConnections(connID int, namespace string) ([]*model.ClientConnection, error) {
	return s.service.ClientConnections(context.Background(), connID, namespace)
}

// ClientChannels returns the channels multiplexed inside those connections.
func (s *RabbitMQService) ClientChannels(connID int, namespace string) ([]*model.ClientChannel, error) {
	return s.service.ClientChannels(context.Background(), connID, namespace)
}

// Health runs the broker's own checks, and reads its feature flags and the
// deprecated features it still allows.
func (s *RabbitMQService) Health(connID int) (*model.BrokerHealth, error) {
	return s.service.Health(context.Background(), connID)
}

// DeadLetterQueues finds the queues dead letters land in, and the queues that
// feed each one.
func (s *RabbitMQService) DeadLetterQueues(connID int, namespace string) ([]*model.DeadLetterQueue, error) {
	return s.service.DeadLetterQueues(context.Background(), connID, namespace)
}

// QueueInput is a queue declaration as the form collects it.
//
// Nothing like TopicInput, and it should not be: a RocketMQ topic is read and
// write queue counts and a permission bitmask, a RabbitMQ queue is a type, a
// lifetime and a bag of arguments the broker validates itself.
type QueueInput struct {
	Vhost      string `json:"vhost"`
	Name       string `json:"name"`
	QueueType  string `json:"queueType"`
	Durable    bool   `json:"durable"`
	AutoDelete bool   `json:"autoDelete"`
	// Arguments is the declaration bag as JSON, so a number stays a number.
	// RabbitMQ rejects a float where it wants an integer, and a string where
	// it wants either.
	Arguments string `json:"arguments"`
}

// DeclareQueue creates a queue.
func (s *RabbitMQService) DeclareQueue(connID int, input QueueInput) error {
	return s.service.DeclareQueue(context.Background(), connID, model.DestinationSpec{
		Ref: model.DestinationRef{Namespace: input.Vhost, Name: input.Name},
		Attributes: map[string]string{
			rabbitmqdriver.AttrQueueType:  input.QueueType,
			rabbitmqdriver.AttrDurable:    strconv.FormatBool(input.Durable),
			rabbitmqdriver.AttrAutoDelete: strconv.FormatBool(input.AutoDelete),
			rabbitmqdriver.AttrArguments:  input.Arguments,
		},
	})
}

// DeleteQueue removes a queue and everything in it.
//
// ifUnused and ifEmpty are the broker's own preconditions. They are checked
// where the delete happens, which is the only place they can be checked
// without a race.
func (s *RabbitMQService) DeleteQueue(connID int, vhost, name string, ifUnused, ifEmpty bool) error {
	return s.service.DeleteQueue(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name}, ifUnused, ifEmpty)
}

// PurgeQueue drops everything a queue is holding. There is no undo.
func (s *RabbitMQService) PurgeQueue(connID int, vhost, name string) error {
	return s.service.PurgeQueue(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name})
}

// MoveInput drains one queue into an exchange.
type MoveInput struct {
	Vhost string `json:"vhost"`
	From  string `json:"from"`
	// ToExchange empty is the default exchange, which routes by queue name.
	ToExchange string `json:"toExchange"`
	// ToRoutingKey empty means each message keeps its own.
	ToRoutingKey string `json:"toRoutingKey"`
	Limit        int    `json:"limit"`
}

// MoveMessages returns how many reached the target, which is meaningful even
// when the call also returns an error: that count already moved.
func (s *RabbitMQService) MoveMessages(connID int, input MoveInput) (int, error) {
	return s.service.MoveMessages(context.Background(), connID, model.MoveRequest{
		Namespace:    input.Vhost,
		From:         input.From,
		ToExchange:   input.ToExchange,
		ToRoutingKey: input.ToRoutingKey,
		Limit:        input.Limit,
	})
}

// RebalanceQueues spreads quorum queue leaders back across the nodes.
func (s *RabbitMQService) RebalanceQueues(connID int) error {
	return s.service.RebalanceQueues(context.Background(), connID)
}

// ExchangeInput is an exchange declaration as the form collects it.
type ExchangeInput struct {
	Vhost      string `json:"vhost"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Transient  bool   `json:"transient"`
	AutoDelete bool   `json:"autoDelete"`
	Arguments  string `json:"arguments"`
}

// DeclareExchange creates an exchange.
func (s *RabbitMQService) DeclareExchange(connID int, input ExchangeInput) error {
	return s.service.DeclareExchange(context.Background(), connID, model.ExchangeSpec{
		Namespace:  input.Vhost,
		Name:       input.Name,
		Type:       input.Type,
		Transient:  input.Transient,
		AutoDelete: input.AutoDelete,
		Arguments:  input.Arguments,
	})
}

// DeleteExchange removes an exchange, and its bindings with it.
func (s *RabbitMQService) DeleteExchange(connID int, vhost, name string) error {
	return s.service.DeleteExchange(context.Background(), connID, vhost, name)
}

// BindingInput describes one route.
type BindingInput struct {
	Vhost           string            `json:"vhost"`
	Source          string            `json:"source"`
	Destination     string            `json:"destination"`
	DestinationKind string            `json:"destinationKind"`
	RoutingKey      string            `json:"routingKey"`
	Arguments       map[string]string `json:"arguments"`
	// PropertiesKey identifies an existing binding for deletion. It comes from
	// the listing; a delete without it is refused rather than guessed at.
	PropertiesKey string `json:"propertiesKey"`
}

func (input BindingInput) binding() model.Binding {
	return model.Binding{
		Namespace:       input.Vhost,
		Source:          input.Source,
		Destination:     input.Destination,
		DestinationKind: input.DestinationKind,
		RoutingKey:      input.RoutingKey,
		Arguments:       input.Arguments,
		PropertiesKey:   input.PropertiesKey,
	}
}

// DeclareBinding routes an exchange to a queue or to another exchange.
func (s *RabbitMQService) DeclareBinding(connID int, input BindingInput) error {
	return s.service.DeclareBinding(context.Background(), connID, input.binding())
}

// DeleteBinding removes one binding.
func (s *RabbitMQService) DeleteBinding(connID int, input BindingInput) error {
	return s.service.DeleteBinding(context.Background(), connID, input.binding())
}

// PublishInput is the send console's form.
type PublishInput struct {
	Vhost string `json:"vhost"`
	// Exchange empty is the default exchange, which routes by queue name.
	Exchange      string            `json:"exchange"`
	RoutingKey    string            `json:"routingKey"`
	Body          string            `json:"body"`
	Persistent    bool              `json:"persistent"`
	Mandatory     bool              `json:"mandatory"`
	Headers       map[string]string `json:"headers"`
	ContentType   string            `json:"contentType"`
	CorrelationID string            `json:"correlationId"`
	ReplyTo       string            `json:"replyTo"`
	MessageID     string            `json:"messageId"`
	Type          string            `json:"type"`
	AppID         string            `json:"appId"`
	Expiration    string            `json:"expiration"`
	Priority      int               `json:"priority"`
	Count         int               `json:"count"`
}

// Publish sends a message and reports how many the broker kept and how many it
// handed back as unroutable. Those are two different facts.
func (s *RabbitMQService) Publish(connID int, input PublishInput) (*model.PublishResult, error) {
	return s.service.Publish(context.Background(), connID, model.PublishRequest{
		Namespace:     input.Vhost,
		Exchange:      input.Exchange,
		RoutingKey:    input.RoutingKey,
		Body:          input.Body,
		Persistent:    input.Persistent,
		Mandatory:     input.Mandatory,
		Headers:       input.Headers,
		ContentType:   input.ContentType,
		CorrelationID: input.CorrelationID,
		ReplyTo:       input.ReplyTo,
		MessageID:     input.MessageID,
		Type:          input.Type,
		AppID:         input.AppID,
		Expiration:    input.Expiration,
		Priority:      input.Priority,
		Count:         input.Count,
	})
}

// DropMessages discards a bounded batch from the head of a queue and reports
// how many are gone. There is no undo.
func (s *RabbitMQService) DropMessages(connID int, vhost, name string, limit int) (int, error) {
	return s.service.DropMessages(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name}, limit)
}

// CloseClientConnection disconnects one connection. The reason reaches the
// client being disconnected and the broker's log.
func (s *RabbitMQService) CloseClientConnection(connID int, name, reason string) error {
	return s.service.CloseClientConnection(context.Background(), connID, name, reason)
}

// CloseUserConnections disconnects every connection one user holds, which is
// how an application running several instances is evicted.
func (s *RabbitMQService) CloseUserConnections(connID int, username, reason string) error {
	return s.service.CloseUserConnections(context.Background(), connID, username, reason)
}

// Namespaces returns every virtual host with its limits.
func (s *RabbitMQService) Namespaces(connID int) ([]*model.Namespace, error) {
	return s.service.Namespaces(context.Background(), connID)
}

// NamespaceInput creates or updates a virtual host.
type NamespaceInput struct {
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Tags             []string `json:"tags"`
	DefaultQueueType string   `json:"defaultQueueType"`
	Tracing          bool     `json:"tracing"`
}

// SaveNamespace creates a virtual host, or updates one that already exists.
func (s *RabbitMQService) SaveNamespace(connID int, input NamespaceInput) error {
	return s.service.SaveNamespace(context.Background(), connID, model.NamespaceSpec{
		Name:             input.Name,
		Description:      input.Description,
		Tags:             input.Tags,
		DefaultQueueType: input.DefaultQueueType,
		Tracing:          input.Tracing,
	})
}

// DeleteNamespace removes a virtual host and everything inside it.
func (s *RabbitMQService) DeleteNamespace(connID int, name string) error {
	return s.service.DeleteNamespace(context.Background(), connID, name)
}

// SetNamespaceLimit caps a virtual host. A negative value lifts the cap, which
// is not the same as a cap of zero - zero forbids everything.
func (s *RabbitMQService) SetNamespaceLimit(connID int, name, limit string, value int) error {
	return s.service.SetNamespaceLimit(context.Background(), connID, name, limit, value)
}

// Identities returns every user with its per-namespace permissions.
func (s *RabbitMQService) Identities(connID int) ([]*model.Identity, error) {
	return s.service.Identities(context.Background(), connID)
}

// IdentityInput creates or updates a user.
type IdentityInput struct {
	Name string   `json:"name"`
	Tags []string `json:"tags"`
	// Password empty keeps whatever is stored.
	Password string `json:"password"`
	// WithoutPassword asks for a user that cannot authenticate with one. It is
	// the opposite instruction from an empty password, not the same one.
	WithoutPassword bool `json:"withoutPassword"`
}

// SaveIdentity creates a user or updates one.
func (s *RabbitMQService) SaveIdentity(connID int, input IdentityInput) error {
	return s.service.SaveIdentity(context.Background(), connID, model.IdentitySpec{
		Name:            input.Name,
		Tags:            input.Tags,
		Password:        input.Password,
		WithoutPassword: input.WithoutPassword,
	})
}

// DeleteIdentity removes a user, its permissions and its open connections.
func (s *RabbitMQService) DeleteIdentity(connID int, name string) error {
	return s.service.DeleteIdentity(context.Background(), connID, name)
}

// PermissionInput grants rights inside one namespace. The three patterns are
// regular expressions: empty permits nothing, ".*" permits everything.
type PermissionInput struct {
	Vhost     string `json:"vhost"`
	Identity  string `json:"identity"`
	Configure string `json:"configure"`
	Write     string `json:"write"`
	Read      string `json:"read"`
}

// SetPermission grants an identity rights inside one namespace.
func (s *RabbitMQService) SetPermission(connID int, input PermissionInput) error {
	return s.service.SetPermission(context.Background(), connID, model.NamespacePermission{
		Namespace: input.Vhost,
		Identity:  input.Identity,
		Configure: input.Configure,
		Write:     input.Write,
		Read:      input.Read,
	})
}

// RevokePermission removes the permission record entirely, which stops the
// identity connecting to that virtual host at all - not the same as granting
// nothing.
func (s *RabbitMQService) RevokePermission(connID int, vhost, identity string) error {
	return s.service.RevokePermission(context.Background(), connID, vhost, identity)
}

// TopicPermissions returns the per-exchange narrowing on top of the namespace
// permissions.
func (s *RabbitMQService) TopicPermissions(connID int) ([]*model.TopicPermission, error) {
	return s.service.TopicPermissions(context.Background(), connID)
}

// TopicPermissionInput narrows write and read on one topic exchange.
type TopicPermissionInput struct {
	Vhost    string `json:"vhost"`
	Identity string `json:"identity"`
	Exchange string `json:"exchange"`
	Write    string `json:"write"`
	Read     string `json:"read"`
}

// SetTopicPermission narrows write and read on one topic exchange.
func (s *RabbitMQService) SetTopicPermission(connID int, input TopicPermissionInput) error {
	return s.service.SetTopicPermission(context.Background(), connID, model.TopicPermission{
		Namespace: input.Vhost,
		Identity:  input.Identity,
		Exchange:  input.Exchange,
		Write:     input.Write,
		Read:      input.Read,
	})
}

// RevokeTopicPermission lifts the narrowing, leaving the namespace permissions
// alone.
func (s *RabbitMQService) RevokeTopicPermission(connID int, vhost, identity string) error {
	return s.service.RevokeTopicPermission(context.Background(), connID, vhost, identity)
}

// Policies returns both user and operator policies, marked apart.
func (s *RabbitMQService) Policies(connID int) ([]*model.Policy, error) {
	return s.service.Policies(context.Background(), connID)
}

// MatchingPolicies asks the broker which policies actually apply to one
// destination. Only the highest-priority match does, and they do not merge.
func (s *RabbitMQService) MatchingPolicies(connID int, vhost, name, kind string) ([]*model.Policy, error) {
	return s.service.MatchingPolicies(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name}, kind)
}

// RabbitPolicyInput creates a policy or replaces one of the same name.
//
// Qualified because "policy" means two different things across the families
// this bridge serves: RocketMQ's PolicyInput is an ACL rule, and this is a
// pattern that applies settings to destinations.
type RabbitPolicyInput struct {
	Vhost    string `json:"vhost"`
	Name     string `json:"name"`
	Pattern  string `json:"pattern"`
	ApplyTo  string `json:"applyTo"`
	Priority int    `json:"priority"`
	// Definition as JSON, so an integer stays an integer.
	Definition string `json:"definition"`
	Operator   bool   `json:"operator"`
}

// SavePolicy creates a policy or replaces one of the same name.
func (s *RabbitMQService) SavePolicy(connID int, input RabbitPolicyInput) error {
	return s.service.SavePolicy(context.Background(), connID, model.Policy{
		Namespace:  input.Vhost,
		Name:       input.Name,
		Pattern:    input.Pattern,
		ApplyTo:    input.ApplyTo,
		Priority:   input.Priority,
		Definition: input.Definition,
		Operator:   input.Operator,
	})
}

// DeletePolicy removes one. Every destination it applied to reverts at once.
func (s *RabbitMQService) DeletePolicy(connID int, vhost, name string, operator bool) error {
	return s.service.DeletePolicy(context.Background(), connID, vhost, name, operator)
}

// RuntimeParameters returns the component configuration the broker stores for
// its plugins - shovels and federation upstreams live here.
func (s *RabbitMQService) RuntimeParameters(connID int) ([]*model.RuntimeParameter, error) {
	return s.service.RuntimeParameters(context.Background(), connID)
}

// DeleteRuntimeParameter removes one component's stored configuration.
func (s *RabbitMQService) DeleteRuntimeParameter(connID int, component, vhost, name string) error {
	return s.service.DeleteRuntimeParameter(context.Background(), connID, component, vhost, name)
}

// Definitions returns the broker's topology as one document, with a count of
// what it holds. An empty vhost exports the whole broker.
func (s *RabbitMQService) Definitions(connID int, vhost string) (*model.Definitions, error) {
	return s.service.ExportDefinitions(context.Background(), connID, vhost)
}

// ExportDefinitionsToFile prompts for a destination and writes the document
// there. It returns the written path, or an empty string when the user
// cancels.
//
// The dialog is here rather than in the renderer because that is where the
// application's window lives; the same pattern serves the settings export.
func (s *RabbitMQService) ExportDefinitionsToFile(connID int, vhost string) (string, error) {
	definitions, err := s.service.ExportDefinitions(context.Background(), connID, vhost)
	if err != nil {
		return "", err
	}

	scope := "broker"
	if vhost != "" {
		scope = strings.NewReplacer("/", "-", " ", "-").Replace(vhost)
	}
	target, err := application.Get().Dialog.SaveFile().
		SetMessage("Export RabbitMQ definitions").
		SetFilename(fmt.Sprintf("rabbitmq-definitions-%s-%s.json",
			strings.TrimPrefix(scope, "-"), time.Now().Format("2006-01-02"))).
		AddFilter("JSON", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil
	}
	if err := os.WriteFile(target, []byte(definitions.Document), 0o600); err != nil {
		return "", fmt.Errorf("write definitions: %w", err)
	}
	return target, nil
}

// DefinitionsPreview is a chosen file, read and counted but not applied.
type DefinitionsPreview struct {
	// Path is empty when the user cancelled the dialog.
	Path     string         `json:"path"`
	Document string         `json:"document"`
	Counts   map[string]int `json:"counts"`
}

// ReadDefinitionsFile prompts for a file and reports what is in it.
//
// Reading and applying are separate steps on purpose: the document is opaque,
// and a count of what it will create is the only review anyone can actually
// perform before it lands on a cluster.
func (s *RabbitMQService) ReadDefinitionsFile() (*DefinitionsPreview, error) {
	source, err := application.Get().Dialog.OpenFile().
		SetTitle("Import RabbitMQ definitions").
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("JSON", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if source == "" {
		return &DefinitionsPreview{}, nil
	}

	document, err := os.ReadFile(source)
	if err != nil {
		return nil, fmt.Errorf("read %q: %w", source, err)
	}
	counts, err := rabbitmqdriver.SummariseDefinitions(string(document))
	if err != nil {
		return nil, err
	}
	return &DefinitionsPreview{Path: source, Document: string(document), Counts: counts}, nil
}

// ImportDefinitions applies a document. An empty vhost applies it broker-wide.
func (s *RabbitMQService) ImportDefinitions(connID int, vhost, document string) error {
	return s.service.ImportDefinitions(context.Background(), connID, vhost, document)
}

// Shovels returns every shovel with the state the broker reports for it. The
// URIs come back with their passwords removed.
func (s *RabbitMQService) Shovels(connID int) ([]*model.Shovel, error) {
	return s.service.Shovels(context.Background(), connID)
}

// DeleteShovel removes a shovel, stopping it.
func (s *RabbitMQService) DeleteShovel(connID int, vhost, name string) error {
	return s.service.DeleteShovel(context.Background(), connID, vhost, name)
}

// FederationUpstreams returns the brokers this one federates from, with their
// links' state.
func (s *RabbitMQService) FederationUpstreams(connID int) ([]*model.FederationUpstream, error) {
	return s.service.FederationUpstreams(context.Background(), connID)
}

// DeleteFederationUpstream removes an upstream, stopping its links.
func (s *RabbitMQService) DeleteFederationUpstream(connID int, vhost, name string) error {
	return s.service.DeleteFederationUpstream(context.Background(), connID, vhost, name)
}
