package rocketmq

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetBrokers returns the broker list.
func (c *Conn) GetBrokers(ctx context.Context) ([]*model.BrokerNode, error) {
	clusterInfo, err := c.GetClusterInfo(ctx)
	if err != nil {
		return nil, err
	}
	return clusterInfo.Brokers, nil
}

// GetBrokerDetail returns details for a broker.
func (c *Conn) GetBrokerDetail(ctx context.Context, brokerAddress string) (*model.BrokerNode, error) {

	broker := &model.BrokerNode{
		Address:    brokerAddress,
		Status:     model.NodeWarning,
		Topics:     -1,
		Groups:     -1,
		TpsIn:      -1,
		TpsOut:     -1,
		LastUpdate: timestamp.Now(),
	}
	if clusterInfo, clusterErr := c.GetClusterInfo(ctx); clusterErr == nil && clusterInfo != nil {
		copyBrokerMetadata(clusterInfo.Brokers, broker)
	}

	if err := c.applyBrokerRuntimeStats(ctx, broker); err != nil {
		return nil, fmt.Errorf("获取 Broker 统计信息失败: %w", err)
	}
	broker.Status = model.NodeOnline

	return broker, nil
}

func copyBrokerMetadata(brokers []*model.BrokerNode, target *model.BrokerNode) {
	for _, broker := range brokers {
		if broker == nil || broker.Address != target.Address {
			continue
		}

		target.ID = broker.ID
		target.Cluster = broker.Cluster
		target.BrokerName = broker.BrokerName
		target.BrokerID = broker.BrokerID
		target.Role = broker.Role
		target.HAAddress = broker.HAAddress
		target.Topics = broker.Topics
		target.Groups = broker.Groups
		target.Remark = broker.Remark
		return
	}
}

// enrichBrokerRuntimeStats populates runtime fields without propagating an
// individual broker failure to a bulk overview request.
func (c *Conn) enrichBrokerRuntimeStats(ctx context.Context, broker *model.BrokerNode) {
	if broker == nil || broker.Address == "" {
		return
	}
	if err := c.applyBrokerRuntimeStats(ctx, broker); err != nil {
		log.Printf("enrichBrokerRuntimeStats(%s): %v", broker.Address, err)
		if IsRetryableNetworkError(err) {
			broker.Status = model.NodeOffline
		} else {
			broker.Status = model.NodeWarning
		}
		return
	}
	broker.Status = model.NodeOnline
}

// applyBrokerRuntimeStats fetches runtime statistics and populates a broker model.
func (c *Conn) applyBrokerRuntimeStats(ctx context.Context, broker *model.BrokerNode) error {
	var stats *admin.KVTable
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		stats, callErr = retryClient.FetchBrokerRuntimeStats(ctx, broker.Address)
		return callErr
	})
	if err != nil {
		return err
	}
	if stats == nil || stats.Table == nil {
		return errors.New("Broker 返回空运行时统计")
	}
	if version, ok := stats.Table["brokerVersionDesc"]; ok {
		broker.Version = version
	}
	// TPS values contain current, five-minute, and fifteen-minute samples.
	if value, ok := stats.Table["putTps"]; ok {
		broker.TpsIn = int(parseFloatSafe(extractFirstValue(value)))
	}
	if value, ok := stats.Table["getTransferredTps"]; ok {
		broker.TpsOut = int(parseFloatSafe(extractFirstValue(value)))
	}
	if value, ok := stats.Table["msgPutTotalTodayNow"]; ok {
		broker.MsgInToday = parseInt64Safe(value)
	}
	if value, ok := stats.Table["msgGetTotalTodayNow"]; ok {
		broker.MsgOutToday = parseInt64Safe(value)
	}
	if value, ok := stats.Table["commitLogDiskRatio"]; ok {
		broker.CommitLogDiskUsage = int(parseFloatSafe(value) * 100)
	}
	if value, ok := stats.Table["consumeQueueDiskRatio"]; ok {
		broker.ConsumeQueueDiskUsage = int(parseFloatSafe(value) * 100)
	}
	return nil
}

// ListDirectoryNodes returns the name servers this connection reaches the
// cluster through.
//
// Local knowledge, not a request: the client holds the address list and the
// admin protocol has no call that asks a name server about itself, let alone
// about its peers. Each therefore comes back with NodeUnknown rather than a
// health nobody checked - one of them is certainly answering, since the
// connection works, but which is not something this can say.
func (c *Conn) ListDirectoryNodes(ctx context.Context) ([]*model.Node, error) {
	addresses := c.current().GetNameServerAddressList()
	nodes := make([]*model.Node, 0, len(addresses))
	for index, address := range addresses {
		nodes = append(nodes, &model.Node{
			ID:      index + 1,
			Name:    address,
			Address: address,
			Status:  model.NodeUnknown,
		})
	}
	return nodes, nil
}
