// Package mqtt drives MQTT brokers over the protocol itself, plus whatever
// management API the particular broker adds on top of it.
//
// This is the first family here with no administrative plane at all. The
// specification covers publishing, subscribing and session state and then
// stops: there is no way to enumerate topics, no consumer group, no offset,
// and no history to page back through. A driver that declared the canonical
// capabilities would be promising what the protocol cannot express.
//
// So what this endpoint can do is decided when it connects, in three tiers:
//
//   - the protocol tier is always there — publish, subscribe, and the retained
//     messages a wildcard subscription replays on the way in;
//   - the $SYS tier is a convention most brokers follow, publishing their own
//     counters under a reserved topic tree;
//   - the management tier is the broker's own REST API, which EMQX and its
//     peers add and Mosquitto does not.
//
// A tier that does not answer is reported through Capabilities.Degraded with
// the reason, so its pages say why they are empty rather than looking broken.
//
// Two client libraries, because Paho's two Go libraries are mutually
// exclusive on protocol version: paho.golang speaks only MQTT 5.0 and
// paho.mqtt.golang only 3.1.1, and a broker that supports one refuses the
// other's CONNECT. The choice is a field on the connection form, and the
// mqttClient seam below is the only place that knows which was taken.
package mqtt

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
//
// They are a private contract between this package and the connection form in
// the renderer, which is why they are spelled out here rather than shared:
// another family's "tls" means whatever that family's driver decides.
const (
	OptionProtocolVersion = "protocolVersion"
	OptionTransport       = "transport"
	OptionWebSocketPath   = "wsPath"
	OptionClientID        = "clientId"
	OptionKeepAliveSec    = "keepAliveSec"
	OptionCleanStart      = "cleanStart"
	OptionSessionExpiry   = "sessionExpirySec"
	OptionTLSCAFile       = "tlsCaFile"
	OptionTLSSkipVerify   = "tlsSkipVerify"
	OptionManagementURL   = "managementUrl"

	SecretUsername       = "username"
	SecretPassword       = "password"
	SecretManagementKey  = "managementApiKey"
	SecretManagementSalt = "managementSecretKey"
)

// The protocol versions the form offers. They are stored as strings because
// every option value is, and "311" rather than "3.1.1" so the stored value
// needs no escaping and sorts next to "5".
const (
	protocol311 = "311"
	protocol5   = "5"
)

// The transports the form offers. MQTT itself is transport-agnostic and all
// four are ordinary in the field — WebSocket especially, because a browser
// client cannot open a raw socket and brokers expose it for them.
const (
	transportTCP = "tcp"
	transportTLS = "tls"
	transportWS  = "ws"
	transportWSS = "wss"
)

// Driver is the MQTT family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindMQTT }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindMQTT,
		DefaultPort:     defaultPortTCP,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				Key:      "endpoints",
				Target:   model.TargetEndpoints,
				Type:     model.FieldEndpointList,
				LabelKey: "mq.mqtt.form.brokerAddress",
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
				// Not a preference. The two versions are carried by two
				// different client libraries here, and a broker configured
				// for one answers the other's CONNECT with a refusal.
				Key:      OptionProtocolVersion,
				Target:   model.TargetOption,
				Type:     model.FieldSelect,
				LabelKey: "mq.mqtt.form.protocolVersion",
				Default:  protocol5,
				Options: []model.FormOption{
					{Value: protocol5, LabelKey: "mq.mqtt.form.protocol5"},
					{Value: protocol311, LabelKey: "mq.mqtt.form.protocol311"},
				},
			},
			{
				Key:      OptionTransport,
				Target:   model.TargetOption,
				Type:     model.FieldSelect,
				LabelKey: "mq.mqtt.form.transport",
				Default:  transportTCP,
				Options: []model.FormOption{
					{Value: transportTCP, LabelKey: "mq.mqtt.form.transportTcp"},
					{Value: transportTLS, LabelKey: "mq.mqtt.form.transportTls"},
					{Value: transportWS, LabelKey: "mq.mqtt.form.transportWs"},
					{Value: transportWSS, LabelKey: "mq.mqtt.form.transportWss"},
				},
			},
			{
				// Brokers disagree about this and there is no default worth
				// guessing silently: EMQX serves /mqtt, Mosquitto serves the
				// root, HiveMQ is configurable.
				Key:         OptionWebSocketPath,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.mqtt.form.wsPath",
				Placeholder: "/mqtt",
				Default:     "/mqtt",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTransport,
					Equals: []string{transportWS, transportWSS},
				},
			},
			{
				// A client id is an identity on the broker, not a label: two
				// connections sharing one take turns being disconnected. Left
				// empty this driver generates a unique one per connection,
				// which is why the field is optional and the placeholder says
				// what happens.
				Key:         OptionClientID,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.mqtt.form.clientId",
				Placeholder: clientName + "-…",
			},
			{
				Key:      OptionKeepAliveSec,
				Target:   model.TargetOption,
				Type:     model.FieldNumber,
				LabelKey: "mq.mqtt.form.keepAliveSec",
				Default:  "60",
				Validate: "int-range",
			},
			{
				Key:      OptionCleanStart,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.mqtt.form.cleanStart",
				Default:  "true",
			},
			{
				// 5.0 only: 3.1.1 has no session expiry, its session lives
				// exactly as long as the connection unless clean session is
				// off, in which case it lives forever.
				Key:      OptionSessionExpiry,
				Target:   model.TargetOption,
				Type:     model.FieldNumber,
				LabelKey: "mq.mqtt.form.sessionExpirySec",
				Default:  "0",
				Validate: "int-range",
				VisibleWhen: &model.FieldCond{
					Field:  OptionProtocolVersion,
					Equals: []string{protocol5},
				},
			},
			{
				Key:      "mechanism",
				Target:   model.TargetAuth,
				Type:     model.FieldSelect,
				LabelKey: "mq.mqtt.form.mechanism",
				Default:  string(model.AuthNone),
				Options: []model.FormOption{
					{Value: string(model.AuthNone), LabelKey: "mq.common.form.authNone"},
					{Value: string(model.AuthPlain), LabelKey: "mq.mqtt.form.authPlain"},
				},
			},
			{
				Key:      SecretUsername,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.mqtt.form.username",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthPlain)},
				},
			},
			{
				Key:      SecretPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.mqtt.form.password",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthPlain)},
				},
			},
			{
				Key:         OptionTLSCAFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.mqtt.form.tlsCaFile",
				Placeholder: "/etc/mosquitto/ca.pem",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTransport,
					Equals: []string{transportTLS, transportWSS},
				},
			},
			{
				Key:      OptionTLSSkipVerify,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.mqtt.form.tlsSkipVerify",
				Default:  "false",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTransport,
					Equals: []string{transportTLS, transportWSS},
				},
			},
			{
				// The broker's own management API, which the protocol has no
				// equivalent of. Optional, and the whole difference between a
				// connection that can list who is connected and one that
				// cannot: Mosquitto has no such endpoint at all.
				Key:         OptionManagementURL,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.mqtt.form.managementUrl",
				Placeholder: "http://127.0.0.1:18083",
				Validate:    "url",
			},
			{
				Key:      SecretManagementKey,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.mqtt.form.managementApiKey",
			},
			{
				Key:      SecretManagementSalt,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.mqtt.form.managementSecretKey",
			},
		},
	}
}

// Open dials the broker and holds the session open.
//
// Unlike Kafka's lazy client this connects eagerly, because MQTT has no
// stateless request to fall back on: everything this driver reads later —
// $SYS counters, retained messages, a live subscription — arrives through a
// session that has to already exist. A failure here is therefore a real dial
// failure, and Open returns it rather than reporting a degraded capability.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, err
	}
	client, err := newClient(config)
	if err != nil {
		return nil, err
	}
	// The connection is built before the dial, not after: it owns the handlers
	// the client delivers through, and a session that reconnects resubscribes
	// from inside the library's own connect callback.
	conn := newConn(client, config)
	if err := client.Connect(ctx); err != nil {
		_ = conn.Close()
		return nil, err
	}
	conn.probe(ctx)
	return conn, nil
}
