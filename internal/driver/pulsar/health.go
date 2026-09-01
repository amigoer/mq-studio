package pulsar

import (
	"context"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// The checks this driver reports, as stable keys the UI labels from.
const (
	// checkBroker is Pulsar's own health check: the broker writes a message to
	// an internal topic and reads it back, so it exercises the broker, the
	// metadata store and BookKeeper in one call. That is why it is worth
	// showing on its own rather than folding into "the connection works".
	checkBroker = "broker"
	// checkLoadReport is whether the load manager publishes figures. It is not
	// a failure when it does not - NoopLoadManager is a valid choice, and the
	// standalone image's default - but it explains a cluster page with no
	// rates on it, which otherwise reads as a broken collector.
	checkLoadReport = "loadReport"
)

// Health is what the cluster answers about itself.
//
// Pulsar has one health endpoint rather than RabbitMQ's dozen, so the list is
// short. It stays a list because the shape is the page's, and because the
// second entry explains an absence the first one cannot.
func (c *Conn) Health(ctx context.Context) (*model.BrokerHealth, error) {
	health := &model.BrokerHealth{Checks: make([]*model.HealthCheck, 0, 2)}

	check := &model.HealthCheck{ID: checkBroker, Passed: true}
	if err := c.admin.Brokers().HealthCheckWithTopicVersionWithContext(ctx, utils.TopicVersionV2); err != nil {
		check.Passed = false
		check.Reason = err.Error()
	}
	health.Checks = append(health.Checks, check)

	// Unavailable rather than failed: a load manager that publishes nothing is
	// a configuration, not a fault, and showing it in red would send someone
	// to fix a cluster that is working.
	report := &model.HealthCheck{ID: checkLoadReport, Passed: true}
	if c.loadReport(ctx) == nil {
		report.Passed = false
		report.Unavailable = true
		report.Reason = loadReportUnavailable
	}
	health.Checks = append(health.Checks, report)

	return health, nil
}
