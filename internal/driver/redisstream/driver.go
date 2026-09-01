// Package redisstream drives Redis Streams over the Redis protocol itself.
//
// There is no separate admin plane. A Redis server administers itself over the
// same connection that carries XADD, so unlike RabbitMQ there is no second
// plane to dial and no way for one half to answer while the other does not.
//
// The family is Redis Streams rather than Redis. A stream is a log with
// consumer groups, acknowledgements and a pending list, which is what this app
// is about; the rest of the keyspace is not a message queue and is not
// modelled here. Pub/Sub channels are excluded for the same reason - a channel
// keeps nothing, so there is no destination to list, browse or replay.
//
// What the family does not have shapes the driver as much as what it does.
// A stream has no partitions, nothing about it is editable once created, there
// is no broker-side dead-letter queue, and a numbered database can be neither
// created nor removed. Those capabilities are never declared, so the UI never
// draws the controls.
package redisstream

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
//
// The strings are a private contract between this package and the Redis module
// under frontend/src/mq/redis. They are deliberately not shared with another
// family's keys of the same name: two drivers spelling TLS the same way today
// is a coincidence, and treating it as an interface would make one of them
// unable to change.
const (
	OptionDeployment    = "deployment"
	OptionMasterName    = "masterName"
	OptionDB            = "db"
	OptionTLS           = "tls"
	OptionTLSSkipVerify = "tlsSkipVerify"
	OptionStreamFilter  = "streamFilter"
	SecretUsername      = "username"
	SecretPassword      = "password"
)

// Driver is the Redis Stream family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindRedisStream }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindRedisStream,
		DefaultPort:     defaultPort,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				// First on the form because it changes what the rest of it
				// means: the same host:port is a server, a sentinel or a
				// cluster endpoint, and nothing about the address says which.
				Key:      OptionDeployment,
				Target:   model.TargetOption,
				Type:     model.FieldSelect,
				LabelKey: "mq.redis-stream.form.deployment",
				Default:  string(DeploymentStandalone),
				Required: true,
				Options: []model.FormOption{
					{Value: string(DeploymentStandalone), LabelKey: "mq.redis-stream.form.standalone"},
					{Value: string(DeploymentSentinel), LabelKey: "mq.redis-stream.form.sentinel"},
					{Value: string(DeploymentCluster), LabelKey: "mq.redis-stream.form.cluster"},
				},
			},
			{
				// A list, because the sentinel and cluster modes are seeded
				// with several addresses. The standalone mode refuses a second
				// one rather than quietly becoming a cluster client.
				Key:      "endpoints",
				Target:   model.TargetEndpoints,
				Type:     model.FieldEndpointList,
				LabelKey: "mq.redis-stream.form.addresses",
				Required: true,
				Validate: "host-port",
			},
			{
				Key:         OptionMasterName,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.redis-stream.form.masterName",
				Placeholder: "mymaster",
				VisibleWhen: &model.FieldCond{
					Field:  OptionDeployment,
					Equals: []string{string(DeploymentSentinel)},
				},
			},
			{
				// Hidden for a cluster, which has one database and refuses
				// SELECT. A field that is present and ignored is worse than
				// one that is absent: it reads as a setting that did nothing.
				Key:      OptionDB,
				Target:   model.TargetOption,
				Type:     model.FieldNumber,
				LabelKey: "mq.redis-stream.form.db",
				Default:  "0",
				Validate: "int-range",
				VisibleWhen: &model.FieldCond{
					Field:  OptionDeployment,
					Equals: []string{string(DeploymentStandalone), string(DeploymentSentinel)},
				},
			},
			{
				// The SCAN MATCH pattern the stream list uses. It is a
				// connection setting rather than a page filter because a
				// production keyspace holds far more than streams, and the
				// scan that finds them is the expensive part - narrowing it
				// once is what keeps the list page usable at all.
				Key:         OptionStreamFilter,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.redis-stream.form.streamFilter",
				Placeholder: "orders:*",
			},
			{
				Key:      OptionTLS,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.redis-stream.form.tls",
				Default:  "false",
			},
			{
				Key:      OptionTLSSkipVerify,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.redis-stream.form.tlsSkipVerify",
				Default:  "false",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTLS,
					Equals: []string{"true"},
				},
			},
			{
				Key:      "timeoutSec",
				Target:   model.TargetOption,
				Type:     model.FieldNumber,
				LabelKey: "mq.common.form.timeoutSec",
				Default:  "5",
				Validate: "int-range",
			},
			{
				// Not required. Redis before 6.0 has no ACL and authenticates
				// with a password alone, and 6.0 onwards treats an omitted
				// username as the default user - so an empty field is a real
				// configuration rather than an unfinished form.
				Key:         SecretUsername,
				Target:      model.TargetSecret,
				Type:        model.FieldText,
				LabelKey:    "mq.redis-stream.form.username",
				Placeholder: "default",
			},
			{
				Key:      SecretPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.redis-stream.form.password",
			},
		},
	}
}

// Open builds the client and probes what this endpoint can do.
//
// It does not fail on a broker that refuses the credential or does not answer:
// go-redis connects lazily, and probe turns whatever the first command says
// into a capability set with a reason attached. A connection that reports why
// it can do nothing is worth more to the user than a dial error, because the
// pages can then say which half is wrong.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, err
	}
	conn := newConn(newClient(config), config)
	conn.probe(ctx)
	return conn, nil
}
