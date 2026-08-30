package cluster

import (
	"context"
	"errors"
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

func (s *Service) topology(connID int) (driver.ClusterAdmin, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.ClusterAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapClusterTopology)
	}
	return api, nil
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// GetBrokers returns every node, empty when nothing is connected.
func (s *Service) GetBrokers(ctx context.Context, connID int) ([]*model.Node, error) {
	return s.nodes(ctx, connID)
}

func (s *Service) nodes(ctx context.Context, connID int) ([]*model.Node, error) {
	api, err := s.topology(connID)
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return []*model.Node{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListNodes(ctx)
}

// GetBrokerDetail returns runtime statistics for one node.
func (s *Service) GetBrokerDetail(ctx context.Context, connID int, address string) (*model.Node, error) {
	api, err := s.topology(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	return api.NodeDetail(ctx, address)
}

// Overview returns the cluster snapshot the overview page renders.
//
// It returns canonical types and leaves assembling the renderer's shape to
// the bridge, which is what keeps this package from importing a driver.
//
// An absent connection yields an empty snapshot rather than an error, which
// is what the page showed before the driver port existed.
func (s *Service) Overview(ctx context.Context, connID int) (*model.ClusterOverview, []*model.Node, error) {
	api, err := s.topology(connID)
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return &model.ClusterOverview{}, []*model.Node{}, nil
		}
		return nil, nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	overview, err := api.ClusterOverview(ctx)
	if err != nil {
		return nil, nil, err
	}
	nodes, err := api.ListNodes(ctx)
	if err != nil {
		return nil, nil, err
	}
	return overview, nodes, nil
}

// CollectTPSSample records one history bucket.
//
// Recording lives here rather than in the driver: a driver reports what a
// broker says right now, and keeping a local time series is the application's
// job. Before the port existed this ran as a side effect of enrichment, which
// is why the driver had to know about the history file.
func (s *Service) CollectTPSSample(ctx context.Context, connID int) error {
	api, err := s.topology(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	nodes, err := api.ListNodes(ctx)
	if err != nil {
		return err
	}
	addresses := make([]string, 0, len(nodes))
	for _, node := range nodes {
		addresses = append(addresses, node.Address)
	}
	s.recordBrokerTPS(addresses, nodes)
	return nil
}

// NodeConfig returns one node's effective settings.
//
// It is a page of its own rather than part of the node detail: a few hundred
// keys is not something a card shows, and it is one request per node.
func (s *Service) NodeConfig(ctx context.Context, connID int, address string) (map[string]string, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	if !conn.Capabilities().Has(model.CapNodeConfig) {
		return nil, driver.Unsupported(conn, model.CapNodeConfig)
	}
	api, ok := conn.(driver.ConfigInspector)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapNodeConfig)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.NodeConfig(ctx, address)
}

// RunMaintenance asks one node to run a housekeeping task now.
//
// The task is validated here rather than in the driver so an unknown one is
// refused before any connection is touched: these reclaim disk and are not
// undoable, and a typo should not reach a broker.
func (s *Service) RunMaintenance(ctx context.Context, connID int, address string, task model.MaintenanceTask) error {
	known := false
	for _, candidate := range model.KnownMaintenanceTasks() {
		if candidate == task {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("unknown maintenance task: %q", task)
	}

	conn, err := s.conns(connID)
	if err != nil {
		return err
	}
	if !conn.Capabilities().Has(model.CapNodeMaintenance) {
		return driver.Unsupported(conn, model.CapNodeMaintenance)
	}
	api, ok := conn.(driver.NodeMaintenance)
	if !ok {
		return driver.Unsupported(conn, model.CapNodeMaintenance)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RunMaintenance(ctx, address, task)
}

// DirectoryConfig returns the effective settings of the cluster's discovery
// tier - the name servers, for RocketMQ.
func (s *Service) DirectoryConfig(ctx context.Context, connID int) (map[string]string, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	if !conn.Capabilities().Has(model.CapNodeConfig) {
		return nil, driver.Unsupported(conn, model.CapNodeConfig)
	}
	api, ok := conn.(driver.ConfigInspector)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapNodeConfig)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DirectoryConfig(ctx)
}
