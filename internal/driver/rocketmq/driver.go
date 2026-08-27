package rocketmq

import (
	"context"
	"fmt"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Secret keys this driver stores in ConnectionProfile.Secrets. They are the
// store's vocabulary, aliased here so the form schema reads in one place.
const (
	SecretAccessKey = model.SecretAccessKey
	SecretSecretKey = model.SecretSecretKey
)

// Driver is the RocketMQ family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindRocketMQ }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindRocketMQ,
		DefaultPort:     "9876",
		MaxCapabilities: rocketMQCapabilities(),
		Form: []model.FormField{
			{
				Key:      "endpoints",
				Target:   model.TargetEndpoints,
				Type:     model.FieldEndpointList,
				LabelKey: "mq.rocketmq.form.nameServer",
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
				Type:     model.FieldSwitch,
				LabelKey: "mq.rocketmq.form.enableAcl",
				Default:  string(model.AuthNone),
				Options: []model.FormOption{
					{Value: string(model.AuthNone), LabelKey: "mq.common.form.authNone"},
					{Value: string(model.AuthACL), LabelKey: "mq.rocketmq.form.authAcl"},
				},
			},
			{
				Key:         SecretAccessKey,
				Target:      model.TargetSecret,
				Type:        model.FieldText,
				LabelKey:    "mq.rocketmq.form.accessKey",
				VisibleWhen: &model.FieldCond{Field: "mechanism", Equals: []string{string(model.AuthACL)}},
			},
			{
				Key:         SecretSecretKey,
				Target:      model.TargetSecret,
				Type:        model.FieldPassword,
				LabelKey:    "mq.rocketmq.form.secretKey",
				VisibleWhen: &model.FieldCond{Field: "mechanism", Equals: []string{string(model.AuthACL)}},
			},
		},
	}
}

// Open dials the NameServers in the profile.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	timeout := time.Duration(profile.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = defaultRequestTimeout
	}
	enableACL := profile.Auth.Mechanism == model.AuthACL
	client, err := GetClientManager().CreateClient(
		profile.Endpoints, timeout, enableACL,
		profile.Secret(SecretAccessKey), profile.Secret(SecretSecretKey))
	if err != nil {
		return nil, fmt.Errorf("open rocketmq connection: %w", err)
	}
	return NewConn(client, profile.Endpoints), nil
}
