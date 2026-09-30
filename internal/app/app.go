// Package app assembles the business services and manages their lifecycle.
package app

import (
	"fmt"
	"log"
	"sync"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/activemq"
	azureservicebusdriver "github.com/amigoer/mq-studio/internal/driver/azureservicebus"
	googlepubsubdriver "github.com/amigoer/mq-studio/internal/driver/googlepubsub"
	ibmmqdriver "github.com/amigoer/mq-studio/internal/driver/ibmmq"
	"github.com/amigoer/mq-studio/internal/driver/kafka"
	kinesisdriver "github.com/amigoer/mq-studio/internal/driver/kinesis"
	"github.com/amigoer/mq-studio/internal/driver/mqtt"
	natsdriver "github.com/amigoer/mq-studio/internal/driver/nats"
	nsqdriver "github.com/amigoer/mq-studio/internal/driver/nsq"
	"github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/driver/rabbitmq"
	"github.com/amigoer/mq-studio/internal/driver/redisstream"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	solacedriver "github.com/amigoer/mq-studio/internal/driver/solace"
	sqsdriver "github.com/amigoer/mq-studio/internal/driver/sqs"
	"github.com/amigoer/mq-studio/internal/service/access"
	activemqservice "github.com/amigoer/mq-studio/internal/service/activemq"
	azureservicebusservice "github.com/amigoer/mq-studio/internal/service/azureservicebus"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/collector"
	"github.com/amigoer/mq-studio/internal/service/configuration"
	"github.com/amigoer/mq-studio/internal/service/connection"
	"github.com/amigoer/mq-studio/internal/service/destination"
	googlepubsubservice "github.com/amigoer/mq-studio/internal/service/googlepubsub"
	ibmmqservice "github.com/amigoer/mq-studio/internal/service/ibmmq"
	kafkaservice "github.com/amigoer/mq-studio/internal/service/kafka"
	kinesisservice "github.com/amigoer/mq-studio/internal/service/kinesis"
	"github.com/amigoer/mq-studio/internal/service/message"
	mqttservice "github.com/amigoer/mq-studio/internal/service/mqtt"
	natsservice "github.com/amigoer/mq-studio/internal/service/nats"
	nsqservice "github.com/amigoer/mq-studio/internal/service/nsq"
	pulsarservice "github.com/amigoer/mq-studio/internal/service/pulsar"
	rabbitmqservice "github.com/amigoer/mq-studio/internal/service/rabbitmq"
	redisstreamservice "github.com/amigoer/mq-studio/internal/service/redisstream"
	"github.com/amigoer/mq-studio/internal/service/routing"
	"github.com/amigoer/mq-studio/internal/service/scope"
	"github.com/amigoer/mq-studio/internal/service/settings"
	solaceservice "github.com/amigoer/mq-studio/internal/service/solace"
	sqsservice "github.com/amigoer/mq-studio/internal/service/sqs"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// Services aggregates business services required by the HTTP transport layer.
type Services struct {
	Connections  *connection.Service
	Cluster      *cluster.Service
	Topics       *destination.Service
	Consumers    *subscription.Service
	Messages     *message.Service
	Settings     *configuration.Service
	ACL          *access.Service
	Routing      *routing.Service
	Scopes       *scope.Service
	RabbitMQ     *rabbitmqservice.Service
	Kafka        *kafkaservice.Service
	MQTT         *mqttservice.Service
	Pulsar       *pulsarservice.Service
	RedisStream  *redisstreamservice.Service
	NATS         *natsservice.Service
	ActiveMQ     *activemqservice.Service
	NSQ          *nsqservice.Service
	SQS          *sqsservice.Service
	GooglePubSub *googlepubsubservice.Service
	ServiceBus   *azureservicebusservice.Service
	Kinesis      *kinesisservice.Service
	IBMMQ        *ibmmqservice.Service
	Solace       *solaceservice.Service

	// Conns resolves a profile id to a live connection. The bridge needs it to
	// answer capability questions without going through a domain service.
	Conns func(connID int) (driver.Conn, error)

	// Collector keeps the TPS history filling in while the window is hidden.
	Collector *collector.Collector

	// registry owns every open connection, one per connected profile.
	registry *driver.Registry

	// settings is what Settings fronts, reached directly only to refresh it.
	settings *settings.Service
}

// New initializes the local encryption key and assembles all business
// services, for the process that owns the stored files.
func New() (*Services, error) {
	services, err := assemble()
	if err != nil {
		return nil, err
	}
	services.Collector.Start()

	// Reopening the last connection used to happen lazily, on whichever data
	// request first found no client. The registry never dials on its own, so
	// the reconnect is explicit - in the background, because a NameServer that
	// is down would otherwise hold the window shut for the dial timeout.
	// ConnectDefault is a no-op when the user has turned auto-connect off.
	go func() {
		if err := services.Connections.ConnectDefault(); err != nil {
			log.Printf("[app] 自动连接默认连接失败: %v", err)
		}
	}()
	return services, nil
}

/*
 * NewReadOnly assembles the same services for a process that does not own the
 * stored files.
 *
 * Two of the things New does are the window's alone, and both of them write.
 * The collector samples on a timer and keeps the TPS history on disk; auto
 * connect dials the default profile through Connect, which stamps a status
 * into the profile store and saves the whole file. Either one from a second
 * process is a race for a file that is rewritten entire, with an in-process
 * lock as its only guard.
 *
 * What is left still reads those files, and still dials - through
 * Connections.OpenReadOnly, which resolves a profile exactly as Connect does
 * and records nothing.
 */
func NewReadOnly() (*Services, error) {
	return assemble()
}

// NewReadOnlyIn is NewReadOnly over a named directory rather than the one this
// installation keeps its files in. It exists so a caller can have a whole
// application against a store it owns outright - which today means a test that
// must be able to say the profile file was not written.
func NewReadOnlyIn(directory string) (*Services, error) {
	return assembleIn(layout.In(directory))
}

// assemble builds the services without starting anything, under the
// directory this installation keeps its files in.
func assemble() (*Services, error) {
	paths, err := layout.Default()
	if err != nil {
		return nil, err
	}
	return assembleIn(paths)
}

// assembleIn is assemble against a given directory, so a test can have a whole
// application over a temporary one.
func assembleIn(paths layout.Layout) (*Services, error) {
	if err := crypto.InitKey(paths.Directory); err != nil {
		return nil, fmt.Errorf("failed to initialize local encryption key: %w", err)
	}

	registerDrivers()

	registry := driver.NewRegistry()
	settingsService := settings.New(paths.SettingsFile)
	connections := connection.New(
		paths.ConnectionsFile, settingsService, newRegistryRuntime(registry), newDescriptorEndpoints())
	configurationService := configuration.New(paths, settingsService, connections)
	conns := newConnSource(registry)
	clusterService := cluster.New(paths.TPSHistoryFile, conns, settingsService)
	services := &Services{
		Connections:  connections,
		Cluster:      clusterService,
		Topics:       destination.New(conns, settingsService),
		Consumers:    subscription.New(conns, settingsService),
		Messages:     message.New(conns, settingsService),
		Settings:     configurationService,
		ACL:          access.New(conns, settingsService),
		Routing:      routing.New(conns, settingsService),
		Scopes:       scope.New(conns, settingsService),
		RabbitMQ:     rabbitmqservice.New(conns, settingsService),
		Kafka:        kafkaservice.New(conns, settingsService),
		MQTT:         mqttservice.New(conns, settingsService),
		Pulsar:       pulsarservice.New(conns, settingsService),
		RedisStream:  redisstreamservice.New(conns, settingsService),
		NATS:         natsservice.New(conns, settingsService),
		ActiveMQ:     activemqservice.New(conns, settingsService),
		NSQ:          nsqservice.New(conns, settingsService),
		SQS:          sqsservice.New(conns, settingsService),
		GooglePubSub: googlepubsubservice.New(conns, settingsService),
		ServiceBus:   azureservicebusservice.New(conns, settingsService),
		Kinesis:      kinesisservice.New(conns, settingsService),
		IBMMQ:        ibmmqservice.New(conns, settingsService),
		Solace:       solaceservice.New(conns, settingsService),
		Conns:        conns,
		Collector:    collector.New(sampleActiveConnection(clusterService, registry), registry.HasActive),
		registry:     registry,
		settings:     settingsService,
	}
	return services, nil
}

// RefreshReadOnly brings a NewReadOnly assembly level with what the window has
// written since it started. Settings go first: a profile that leans on the
// global credentials is dialled from both files, and the connections judge
// their open clients by what the settings say now.
//
// Never call it from the window's assembly, whose state in memory is the
// authority over those files rather than a copy of them.
func (s *Services) RefreshReadOnly() error {
	if s.settings != nil {
		if err := s.settings.RefreshReadOnly(); err != nil {
			return fmt.Errorf("the saved settings could not be read again: %w", err)
		}
	}
	if s.Connections != nil {
		if err := s.Connections.RefreshReadOnly(); err != nil {
			return fmt.Errorf("the saved connections could not be read again: %w", err)
		}
	}
	return nil
}

// Close stops background sampling and releases every open connection.
func (s *Services) Close() {
	if s.Collector != nil {
		s.Collector.Stop()
	}
	if s.registry != nil {
		s.registry.CloseAll()
	}
}

// registerDrivers makes the compiled-in families available to the catalog and
// to anything opening a connection.
//
// The driver catalog is process-global and Register panics on a duplicate,
// which is right: a second driver claiming a kind is a build mistake. That
// makes this a once-per-process job rather than a once-per-Services one, which
// only became visible when a second assembly in the same process became
// possible.
var registerDrivers = sync.OnceFunc(func() {
	driver.Register(rocketmq.New())
	driver.Register(rabbitmq.New())
	driver.Register(kafka.New())
	driver.Register(mqtt.New())
	driver.Register(pulsar.New())
	driver.Register(redisstream.New())
	driver.Register(natsdriver.New())
	driver.Register(activemq.New())
	driver.Register(nsqdriver.New())
	driver.Register(sqsdriver.New())
	driver.Register(googlepubsubdriver.New())
	driver.Register(azureservicebusdriver.New())
	driver.Register(kinesisdriver.New())
	driver.Register(ibmmqdriver.New())
	driver.Register(solacedriver.New())
})
