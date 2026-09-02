// Package pulsar drives Apache Pulsar across its two planes.
//
// Pulsar splits administration from data the way RabbitMQ does, and for the
// same practical reason: the admin plane is HTTP on the web service port and
// the data plane is a binary protocol on the broker port. Either can be
// reachable while the other is not - a token with no permission on a tenant
// reads every admin page and publishes nothing - so both are probed at connect
// time and degraded separately.
//
// What the family does not have shapes the driver as much as what it does.
// There is no broker-side dead-letter object (the DLQ is an ordinary topic the
// client library names by convention), no message trace, no principal
// directory to enumerate, and no exchange to bind - so those capabilities are
// never declared and the UI never draws the controls.
package pulsar

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
const (
	OptionAdminURL      = "adminUrl"
	OptionTenant        = "tenant"
	OptionNamespace     = "namespace"
	OptionTLS           = "tls"
	OptionTLSSkipVerify = "tlsSkipVerify"
	OptionTLSCAFile     = "tlsCaFile"
	SecretToken         = "token"

	// defaultPort is the broker's binary listener, not the web service port.
	// The connection form leads with the service URL because that is the
	// address a Pulsar user knows by heart.
	defaultPort = "6650"

	defaultTenant    = "public"
	defaultNamespace = "default"
)

// Driver is the Pulsar family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindPulsar }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindPulsar,
		DefaultPort:     defaultPort,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				Key:         "endpoints",
				Target:      model.TargetEndpoints,
				Type:        model.FieldText,
				LabelKey:    "mq.pulsar.form.serviceUrl",
				Placeholder: "pulsar://localhost:6650",
				Required:    true,
				Validate:    "url",
			},
			{
				// Separate from the service URL rather than derived from it.
				// The two ports are routinely behind different ingresses, and
				// guessing 8080 from a 6650 host is wrong the moment either
				// is proxied.
				Key:         OptionAdminURL,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.pulsar.form.adminUrl",
				Placeholder: "http://localhost:8080",
				Required:    true,
				Validate:    "url",
			},
			{
				Key:      OptionTenant,
				Target:   model.TargetOption,
				Type:     model.FieldText,
				LabelKey: "mq.pulsar.form.tenant",
				Default:  defaultTenant,
			},
			{
				Key:      OptionNamespace,
				Target:   model.TargetOption,
				Type:     model.FieldText,
				LabelKey: "mq.pulsar.form.namespace",
				Default:  defaultNamespace,
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
				LabelKey: "mq.pulsar.form.mechanism",
				Default:  string(model.AuthNone),
				Options: []model.FormOption{
					{Value: string(model.AuthNone), LabelKey: "mq.common.form.authNone"},
					{Value: string(model.AuthToken), LabelKey: "mq.pulsar.form.authToken"},
				},
			},
			{
				Key:      SecretToken,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.pulsar.form.token",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthToken)},
				},
			},
			{
				Key:      OptionTLS,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.pulsar.form.tls",
				Default:  "false",
			},
			{
				Key:         OptionTLSCAFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.pulsar.form.tlsCaFile",
				VisibleWhen: &model.FieldCond{Field: OptionTLS, Equals: []string{"true"}},
			},
			{
				Key:         OptionTLSSkipVerify,
				Target:      model.TargetOption,
				Type:        model.FieldSwitch,
				LabelKey:    "mq.pulsar.form.tlsSkipVerify",
				Default:     "false",
				VisibleWhen: &model.FieldCond{Field: OptionTLS, Equals: []string{"true"}},
			},
		},
	}
}

// Open dials both planes and narrows the capability set to what they answer.
//
// Neither plane being reachable is still a connection, not an error: the
// profile is what the user asked for, and a Conn that reports every capability
// degraded with a reason is more use than a failure with a Go error in it.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, err
	}
	admin, transport, err := newAdmin(config)
	if err != nil {
		return nil, err
	}
	client, err := newDataPlane(config)
	if err != nil {
		return nil, err
	}
	conn := newConn(admin, client, transport, config)
	conn.probe(ctx)
	return conn, nil
}
