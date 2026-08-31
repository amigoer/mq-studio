// Package kafka drives Apache Kafka over the Kafka protocol itself.
//
// There is no separate admin plane. A Kafka cluster administers itself over
// the same protocol that carries records, so one client answers both and the
// capability probe has one question to ask: does this cluster describe itself
// to this credential.
//
// What the family does not have shapes the driver as much as what it does.
// There is no broker-side dead-letter queue, no delayed delivery, no message
// trace, no routing topology, and no way to enumerate the connections a broker
// is holding - so those capabilities are never declared and the UI never draws
// the controls.
package kafka

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
const (
	OptionSCRAMSHA      = "scramSha"
	OptionTLS           = "tls"
	OptionTLSSkipVerify = "tlsSkipVerify"
	OptionTLSCAFile     = "tlsCaFile"
	SecretUsername      = "username"
	SecretPassword      = "password"

	scramSHA256 = "256"
	scramSHA512 = "512"
)

// Driver is the Kafka family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindKafka }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindKafka,
		DefaultPort:     defaultPort,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				Key:      "endpoints",
				Target:   model.TargetEndpoints,
				Type:     model.FieldEndpointList,
				LabelKey: "mq.kafka.form.bootstrapServers",
				Required: true,
				Validate: "host-port",
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
				Key:      "mechanism",
				Target:   model.TargetAuth,
				Type:     model.FieldSelect,
				LabelKey: "mq.kafka.form.mechanism",
				Default:  string(model.AuthNone),
				Options: []model.FormOption{
					{Value: string(model.AuthNone), LabelKey: "mq.common.form.authNone"},
					{Value: string(model.AuthSASLPlain), LabelKey: "mq.kafka.form.authSaslPlain"},
					{Value: string(model.AuthSASLScram), LabelKey: "mq.kafka.form.authSaslScram"},
				},
			},
			{
				// A refinement of the mechanism above rather than a second
				// decision: Kafka's two SCRAM digests are separate credentials
				// on the broker, so a user that exists under one fails under
				// the other.
				Key:      OptionSCRAMSHA,
				Target:   model.TargetOption,
				Type:     model.FieldSelect,
				LabelKey: "mq.kafka.form.scramSha",
				Default:  scramSHA512,
				Options: []model.FormOption{
					{Value: scramSHA256, LabelKey: "mq.kafka.form.scramSha256"},
					{Value: scramSHA512, LabelKey: "mq.kafka.form.scramSha512"},
				},
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthSASLScram)},
				},
			},
			{
				Key:      SecretUsername,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.kafka.form.username",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthSASLPlain), string(model.AuthSASLScram)},
				},
			},
			{
				Key:      SecretPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.kafka.form.password",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthSASLPlain), string(model.AuthSASLScram)},
				},
			},
			{
				Key:      OptionTLS,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.kafka.form.tls",
				Default:  "false",
			},
			{
				Key:         OptionTLSCAFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.kafka.form.tlsCaFile",
				Placeholder: "/etc/kafka/ca.pem",
				VisibleWhen: &model.FieldCond{Field: OptionTLS, Equals: []string{"true"}},
			},
			{
				Key:         OptionTLSSkipVerify,
				Target:      model.TargetOption,
				Type:        model.FieldSwitch,
				LabelKey:    "mq.kafka.form.tlsSkipVerify",
				Default:     "false",
				VisibleWhen: &model.FieldCond{Field: OptionTLS, Equals: []string{"true"}},
			},
		},
	}
}

// Open builds a client for the profile and probes what the cluster answers.
//
// franz-go connects lazily, so nothing is dialled until the probe asks for
// metadata. That is deliberate: a failure surfaces as a classified capability
// reason rather than an error from Open that the connection list would show as
// a bare string.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, err
	}
	client, admin, err := newClient(config)
	if err != nil {
		return nil, err
	}

	conn := newConn(client, admin, config)
	conn.probe(ctx)
	return conn, nil
}
