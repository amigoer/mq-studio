// Package nats drives NATS servers over the protocol itself, the JetStream
// API, the server's HTTP monitoring endpoint, and the system account.
//
// Four sources, because NATS has no single administrative plane and the ones
// it has can each be absent independently:
//
//   - the protocol tier is always there once a connection opens - publish,
//     subscribe, request/reply, and the server INFO that arrives with the
//     handshake;
//   - JetStream is the persistence layer, and it is optional twice over: a
//     server can be built without it, and an account can be denied it;
//   - the monitoring endpoint is an HTTP port the operator turns on, and it
//     answers for the one server it belongs to;
//   - the system account fans a request out to every server in the cluster,
//     and needs credentials for an account most people never hand out.
//
// The last two overlap on purpose. Monitoring answers for one server where
// $SYS answers for all of them, so a cluster reached through monitoring alone
// reports one node and a cluster reached through $SYS reports the topology -
// and an endpoint with neither cannot answer the cluster pages at all. Which
// of the four answered is decided at connect time and reported through
// Capabilities.Degraded, so a page says why it is empty rather than looking
// broken.
package nats

import (
	"context"

	natsclient "github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Option and secret keys this driver stores in a connection profile.
//
// They are a private contract between this package and the connection form in
// the renderer, which is why they are spelled out here rather than shared:
// another family's "tls" means whatever that family's driver decides.
const (
	OptionTLS           = "tls"
	OptionTLSCAFile     = "tlsCaFile"
	OptionTLSCertFile   = "tlsCertFile"
	OptionTLSKeyFile    = "tlsKeyFile"
	OptionTLSSkipVerify = "tlsSkipVerify"
	OptionMonitorURL    = "monitorUrl"
	OptionJSDomain      = "jsDomain"
	OptionCredsFile     = "credsFile"

	SecretUsername       = "username"
	SecretPassword       = "password"
	SecretToken          = "token"
	SecretNKeySeed       = "nkeySeed"
	SecretSystemUser     = "systemUser"
	SecretSystemPassword = "systemPassword"
)

// Driver is the NATS family.
type Driver struct{}

// New creates the driver.
func New() *Driver { return &Driver{} }

// Kind identifies the family.
func (d *Driver) Kind() model.MQKind { return model.KindNATS }

// Descriptor is the connection form and the family's best-case capabilities.
func (d *Driver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{
		Kind:            model.KindNATS,
		DefaultPort:     defaultPort,
		MaxCapabilities: capabilities(),
		Form: []model.FormField{
			{
				Key:      "endpoints",
				Target:   model.TargetEndpoints,
				Type:     model.FieldEndpointList,
				LabelKey: "mq.nats.form.servers",
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
				// Five mechanisms because NATS really has five, and they are
				// not preferences: a server configured for one refuses the
				// others outright.
				Key:      "mechanism",
				Target:   model.TargetAuth,
				Type:     model.FieldSelect,
				LabelKey: "mq.nats.form.mechanism",
				Default:  string(model.AuthNone),
				Options: []model.FormOption{
					{Value: string(model.AuthNone), LabelKey: "mq.common.form.authNone"},
					{Value: string(model.AuthPlain), LabelKey: "mq.nats.form.authPlain"},
					{Value: string(model.AuthToken), LabelKey: "mq.nats.form.authToken"},
					{Value: string(model.AuthNKey), LabelKey: "mq.nats.form.authNkey"},
					{Value: string(model.AuthCreds), LabelKey: "mq.nats.form.authCreds"},
					{Value: string(model.AuthMutualTLS), LabelKey: "mq.nats.form.authMtls"},
				},
			},
			{
				Key:      SecretUsername,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.nats.form.username",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthPlain)},
				},
			},
			{
				Key:      SecretPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.nats.form.password",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthPlain)},
				},
			},
			{
				Key:      SecretToken,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.nats.form.token",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthToken)},
				},
			},
			{
				// The seed itself, not a path to it. It is the whole
				// credential, this app encrypts what it stores, and a path
				// would leave the one thing worth protecting on disk in the
				// clear.
				Key:         SecretNKeySeed,
				Target:      model.TargetSecret,
				Type:        model.FieldPassword,
				LabelKey:    "mq.nats.form.nkeySeed",
				Placeholder: "SU…",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthNKey)},
				},
			},
			{
				// A path here, and that is not an inconsistency with the seed
				// above: a creds file carries a JWT as well as a seed, the
				// library reads both out of the file, and pasting one into a
				// text box is not how anybody holds one.
				Key:         OptionCredsFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.nats.form.credsFile",
				Placeholder: "~/.nkeys/creds/…/user.creds",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthCreds)},
				},
			},
			{
				Key:      OptionTLS,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.nats.form.tls",
				Default:  "false",
			},
			{
				Key:         OptionTLSCAFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.nats.form.tlsCaFile",
				Placeholder: "/etc/nats/ca.pem",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTLS,
					Equals: []string{"true"},
				},
			},
			{
				Key:         OptionTLSCertFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.nats.form.tlsCertFile",
				Placeholder: "/etc/nats/client-cert.pem",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthMutualTLS)},
				},
			},
			{
				Key:         OptionTLSKeyFile,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.nats.form.tlsKeyFile",
				Placeholder: "/etc/nats/client-key.pem",
				VisibleWhen: &model.FieldCond{
					Field:  "mechanism",
					Equals: []string{string(model.AuthMutualTLS)},
				},
			},
			{
				Key:      OptionTLSSkipVerify,
				Target:   model.TargetOption,
				Type:     model.FieldSwitch,
				LabelKey: "mq.nats.form.tlsSkipVerify",
				Default:  "false",
				VisibleWhen: &model.FieldCond{
					Field:  OptionTLS,
					Equals: []string{"true"},
				},
			},
			{
				// The server's own HTTP monitoring port, which the protocol
				// has no equivalent of. Optional, and the difference between
				// a connection that can show what a server is doing and one
				// that cannot: it is off unless the operator started the
				// server with -m.
				Key:         OptionMonitorURL,
				Target:      model.TargetOption,
				Type:        model.FieldText,
				LabelKey:    "mq.nats.form.monitorUrl",
				Placeholder: "http://127.0.0.1:8222",
				Validate:    "url",
			},
			{
				// The system account is a second account, so these are a
				// second credential rather than the same one reused. Without
				// them the cluster can only be asked about one server at a
				// time, through the endpoint above.
				Key:      SecretSystemUser,
				Target:   model.TargetSecret,
				Type:     model.FieldText,
				LabelKey: "mq.nats.form.systemUser",
			},
			{
				Key:      SecretSystemPassword,
				Target:   model.TargetSecret,
				Type:     model.FieldPassword,
				LabelKey: "mq.nats.form.systemPassword",
			},
			{
				// Empty is the right default and covers every cluster that
				// has not been split by a leaf node. It is on the form because
				// where domains are in use, guessing wrong means the
				// JetStream API subject goes nowhere and the pages look like
				// a server without JetStream.
				Key:      OptionJSDomain,
				Target:   model.TargetOption,
				Type:     model.FieldText,
				LabelKey: "mq.nats.form.jsDomain",
			},
		},
	}
}

// Open dials the server and probes what it will answer.
//
// It connects eagerly, like MQTT and unlike Kafka's lazy client, because
// everything read afterwards - the JetStream API, a live subscription, the
// system account - goes through a connection that has to already exist. A
// failure here is a real dial failure and is returned as one, rather than
// reported as a degraded capability.
func (d *Driver) Open(ctx context.Context, profile model.ConnectionProfile) (driver.Conn, error) {
	config, err := configOf(profile)
	if err != nil {
		return nil, err
	}
	conn := &Conn{config: config, streams: make(map[string]*liveStream)}

	options, err := config.dialOptions("")
	if err != nil {
		return nil, err
	}
	// The handlers go on before the dial, not after. A session that reconnects
	// resubscribes from inside the library's own callback, and a page that
	// cannot tell a dropped session from a quiet subject shows a stalled panel
	// as a working one.
	options = append(options,
		natsclient.DisconnectErrHandler(func(*natsclient.Conn, error) {
			conn.setLiveStreamsLive(false)
		}),
		natsclient.ReconnectHandler(func(*natsclient.Conn) {
			conn.setLiveStreamsLive(true)
		}),
	)

	nc, err := natsclient.Connect(serverList(config.Servers), options...)
	if err != nil {
		return nil, err
	}
	conn.nc = nc
	// The JetStream handle is built whether or not the server has JetStream:
	// it is a subject prefix and a codec, not a session, so constructing it
	// cannot fail for a server that lacks the subsystem. Finding that out is
	// the probe's job, and it takes a request to do it.
	if js, err := newJetStream(nc, config); err == nil {
		conn.js = js
	}
	conn.probe(ctx)
	return conn, nil
}

// newJetStream builds the API handle, in the domain the form named.
func newJetStream(nc *natsclient.Conn, config clientConfig) (jetstream.JetStream, error) {
	if config.JSDomain != "" {
		return jetstream.NewWithDomain(nc, config.JSDomain)
	}
	return jetstream.New(nc)
}
