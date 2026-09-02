package rocketmq

import (
	"context"
	"fmt"
	"strings"
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
				Key:      OptionNamespace,
				Target:   model.TargetOption,
				Type:     model.FieldText,
				LabelKey: "mq.rocketmq.form.namespace",
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

// How a 5.x profile says which kind of endpoint it names.
const (
	OptionAccess = "access"
	AccessProxy  = "proxy"
)

// OptionNamespace scopes the connection to one RocketMQ 5.x namespace: the
// same thing a client sets as ClientConfig.namespace and a public cloud calls
// the instance id. Empty means the connection sees the cluster unscoped.
const OptionNamespace = "namespace"

// configOf reads a profile into the parameters this driver dials with.
//
// A Proxy endpoint is refused rather than dialled. The 5.x Proxy is a data
// plane: it answers no route, topology or ACL request, so every page this app
// has would come back empty. Dialling it anyway would fail somewhere deep in
// the first admin call, with a network error that says nothing about why.
func configOf(profile model.ConnectionProfile) (ClientConfig, error) {
	if profile.Option(OptionAccess) == AccessProxy {
		return ClientConfig{}, fmt.Errorf(
			"RocketMQ Proxy 只有数据面，没有管理接口；请填写 NameServer 地址")
	}
	timeout := time.Duration(profile.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = defaultRequestTimeout
	}
	config, err := NewClientConfig(
		profile.Endpoints, timeout,
		profile.Auth.Mechanism == model.AuthACL,
		profile.Secret(SecretAccessKey), profile.Secret(SecretSecretKey))
	if err != nil {
		return ClientConfig{}, err
	}
	namespace := strings.TrimSpace(profile.Option(OptionNamespace))
	if err := ValidateNamespace(namespace); err != nil {
		return ClientConfig{}, err
	}
	config.Namespace = namespace
	return config, nil
}

// Open dials the NameServers in the profile.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, fmt.Errorf("open rocketmq connection: %w", err)
	}
	client, err := Dial(config)
	if err != nil {
		return nil, fmt.Errorf("open rocketmq connection: %w", err)
	}
	return NewConn(client, config, profile.Endpoints), nil
}
