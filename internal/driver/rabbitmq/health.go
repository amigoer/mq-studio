package rabbitmq

import (
	"context"
	"errors"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// The checks this driver runs, in the order the page shows them. They are ids
// rather than sentences: the renderer turns each into the user's own language.
const (
	CheckAlarms       = "alarms"
	CheckLocalAlarms  = "localAlarms"
	CheckVirtualHosts = "virtualHosts"
	CheckQuorum       = "quorumCritical"
	CheckMirrorSync   = "mirrorSyncCritical"
	CheckCertificates = "certificateExpiry"
)

// certificateWindow is how far ahead the certificate check looks.
//
// A month is the shortest window that is still actionable: renewing a TLS
// certificate usually needs a change window, and a check that only fires the
// week it expires is a check that fires too late.
const certificateWindow = 30

// Health runs the broker's own checks and reads what it says about its
// feature flags.
//
// Every check is run, and one that fails does not stop the others: they are
// independent questions, and an operator looking at a cluster in trouble wants
// all the answers rather than the first failure.
func (c *Conn) Health(ctx context.Context) (*model.BrokerHealth, error) {
	health := &model.BrokerHealth{}

	alarms, alarmCheck := c.alarmCheck(ctx, CheckAlarms, func(client *rabbithole.Client) (rabbithole.ResourceAlarmCheckStatus, error) {
		return client.HealthCheckAlarms()
	})
	health.Checks = append(health.Checks, alarmCheck)
	health.Alarms = alarms

	_, localAlarms := c.alarmCheck(ctx, CheckLocalAlarms, func(client *rabbithole.Client) (rabbithole.ResourceAlarmCheckStatus, error) {
		return client.HealthCheckLocalAlarms()
	})
	health.Checks = append(health.Checks, localAlarms)

	health.Checks = append(health.Checks,
		c.statusCheck(ctx, CheckVirtualHosts, func(client *rabbithole.Client) (rabbithole.HealthCheckStatus, error) {
			return client.HealthCheckVirtualHosts()
		}),
		c.statusCheck(ctx, CheckQuorum, func(client *rabbithole.Client) (rabbithole.HealthCheckStatus, error) {
			return client.HealthCheckNodeIsQuorumCritical()
		}),
		c.statusCheck(ctx, CheckMirrorSync, func(client *rabbithole.Client) (rabbithole.HealthCheckStatus, error) {
			return client.HealthCheckNodeIsMirrorSyncCritical()
		}),
		c.statusCheck(ctx, CheckCertificates, func(client *rabbithole.Client) (rabbithole.HealthCheckStatus, error) {
			return client.HealthCheckCertificateExpiration(certificateWindow, rabbithole.DAYS)
		}),
	)

	health.FeatureFlags = c.featureFlags(ctx)
	health.DeprecatedFeatures = c.deprecatedFeatures(ctx)
	return health, nil
}

func (c *Conn) statusCheck(
	ctx context.Context,
	id string,
	run func(*rabbithole.Client) (rabbithole.HealthCheckStatus, error),
) *model.HealthCheck {
	status, err := call(ctx, c.mgmt, run)
	if err != nil {
		return failedCheck(id, err)
	}
	return &model.HealthCheck{ID: id, Passed: status.Status == "ok", Reason: status.Reason}
}

func (c *Conn) alarmCheck(
	ctx context.Context,
	id string,
	run func(*rabbithole.Client) (rabbithole.ResourceAlarmCheckStatus, error),
) ([]*model.ResourceAlarm, *model.HealthCheck) {
	status, err := call(ctx, c.mgmt, run)
	if err != nil {
		return nil, failedCheck(id, err)
	}
	alarms := make([]*model.ResourceAlarm, 0, len(status.Alarms))
	for _, alarm := range status.Alarms {
		alarms = append(alarms, &model.ResourceAlarm{Node: alarm.Node, Resource: alarm.Resource})
	}
	return alarms, &model.HealthCheck{
		ID:     id,
		Passed: status.Status == "ok",
		Reason: status.Reason,
	}
}

// failedCheck tells a check that could not run apart from one that ran and
// failed.
//
// A 404 is an endpoint this broker does not have - an older version, or one
// that needs a plugin - and showing that as a failure would have an operator
// chasing a problem that is not there. A 503 is the documented way these
// endpoints report a real failure, so it is one.
func failedCheck(id string, err error) *model.HealthCheck {
	var response rabbithole.ErrorResponse
	if errors.As(err, &response) {
		if response.StatusCode == http.StatusNotFound {
			return &model.HealthCheck{ID: id, Unavailable: true, Reason: response.Reason}
		}
		return &model.HealthCheck{ID: id, Reason: response.Reason}
	}
	return &model.HealthCheck{ID: id, Reason: err.Error()}
}

// phaseName spells the deprecation phase out.
//
// The library decodes it into an int, so converting it with string() would
// produce one rune rather than a word - and the phase is the whole point: it
// is the difference between a feature that still works and one a later release
// will refuse.
func phaseName(phase rabbithole.DeprecationPhase) string {
	switch phase {
	case rabbithole.DeprecationPermittedByDefault:
		return "permitted_by_default"
	case rabbithole.DeprecationDeniedByDefault:
		return "denied_by_default"
	case rabbithole.DeprecationDisconnected:
		return "disconnected"
	case rabbithole.DeprecationRemoved:
		return "removed"
	default:
		return "unknown"
	}
}

func (c *Conn) featureFlags(ctx context.Context) []*model.FeatureFlag {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.FeatureFlag, error) {
		return client.ListFeatureFlags()
	})
	if err != nil {
		return nil
	}
	flags := make([]*model.FeatureFlag, 0, len(found))
	for _, flag := range found {
		flags = append(flags, &model.FeatureFlag{
			Name:        flag.Name,
			Description: flag.Desc,
			State:       string(flag.State),
			Stability:   string(flag.Stability),
			ProvidedBy:  flag.ProvidedBy,
			DocURL:      flag.DocURL,
		})
	}
	return flags
}

// deprecatedFeatures marks the ones this cluster is actually using.
//
// Two calls rather than one, because the broker keeps two lists and the
// difference between them is the whole point: what is deprecated is
// background, what is deprecated and in use here is a work item.
func (c *Conn) deprecatedFeatures(ctx context.Context) []*model.DeprecatedFeature {
	all, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.DeprecatedFeature, error) {
		return client.ListDeprecatedFeatures()
	})
	if err != nil {
		return nil
	}
	used, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.DeprecatedFeature, error) {
		return client.ListDeprecatedFeaturesUsed()
	})
	inUse := make(map[string]bool, len(used))
	if err == nil {
		for _, feature := range used {
			inUse[feature.Name] = true
		}
	}

	features := make([]*model.DeprecatedFeature, 0, len(all))
	for _, feature := range all {
		features = append(features, &model.DeprecatedFeature{
			Name:        feature.Name,
			Description: feature.Description,
			Phase:       phaseName(feature.Phase),
			ProvidedBy:  feature.ProvidedBy,
			DocURL:      feature.DocumentationUrl,
			InUse:       inUse[feature.Name],
		})
	}
	return features
}
