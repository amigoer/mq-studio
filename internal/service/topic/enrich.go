package topic

import (
	"context"
	"errors"
	"math"
	"sort"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// Broker statistics buckets. RocketMQ keys inbound samples by topic name and
// outbound samples by "topic@group".
const (
	statsTopicPutNums = "TOPIC_PUT_NUMS"
	statsGroupGetNums = "GROUP_GET_NUMS"
)

// Per-topic enrichment needs one request per topic per broker. Bound the
// fan-out so a cluster with many topics cannot flood the brokers.
const enrichConcurrency = 12

// unknownMetric marks a field no broker reported. The UI renders it as "—"
// rather than a zero that would read as "measured, and it is idle".
const unknownMetric = -1

// masterBroker is a writable broker and the address used to reach it.
type masterBroker struct {
	cluster string
	name    string
	addr    string
}

// brokerTopicConfig is one broker's copy of a topic configuration.
type brokerTopicConfig struct {
	broker     masterBroker
	readQueue  int
	writeQueue int
	perm       int
	order      bool
}

// listMasterBrokers returns the master of every broker set, ordered by name.
// BrokerAddrTable is a map, so without the sort the broker a summary value
// comes from would change between refreshes.
func listMasterBrokers(ctx context.Context, client *admin.Client) []masterBroker {
	clusterInfo, err := client.ExamineBrokerClusterInfo(ctx)
	if err != nil || clusterInfo == nil {
		return nil
	}

	clusterOf := make(map[string]string, len(clusterInfo.BrokerAddrTable))
	for clusterName, brokerNames := range clusterInfo.ClusterAddrTable {
		for _, brokerName := range brokerNames {
			if _, exists := clusterOf[brokerName]; !exists {
				clusterOf[brokerName] = clusterName
			}
		}
	}

	masters := make([]masterBroker, 0, len(clusterInfo.BrokerAddrTable))
	for brokerName, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		address := brokerData.BrokerAddrs["0"]
		if address == "" {
			continue
		}
		clusterName := brokerData.Cluster
		if clusterName == "" {
			clusterName = clusterOf[brokerName]
		}
		masters = append(masters, masterBroker{cluster: clusterName, name: brokerName, addr: address})
	}
	sort.Slice(masters, func(left, right int) bool {
		return masters[left].name < masters[right].name
	})
	return masters
}

// enrichTopics fills the columns the topic list shows beyond the name. It is
// best effort by design: every field keeps its unknown sentinel when a broker
// cannot answer, so a slow or partially degraded cluster still renders a list.
func (s *Service) enrichTopics(client *admin.Client, items []*model.TopicItem) {
	if client == nil || len(items) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
	defer cancel()

	masters := listMasterBrokers(ctx, client)
	if len(masters) == 0 {
		return
	}

	configs := fetchTopicConfigs(ctx, client, masters)
	applyTopicConfigs(items, configs)
	enrichTopicMetrics(ctx, client, items, configs)
}

// fetchTopicConfigs reads every master's full topic config table. One request
// per broker covers every topic, which is what keeps queue counts, permission
// and ordering cheap no matter how many topics the cluster holds.
func fetchTopicConfigs(
	ctx context.Context,
	client *admin.Client,
	masters []masterBroker,
) map[string][]brokerTopicConfig {
	tables := make([]map[string]*admin.TopicConfig, len(masters))
	var waitGroup sync.WaitGroup
	for index, master := range masters {
		waitGroup.Add(1)
		go func(slot int, broker masterBroker) {
			defer waitGroup.Done()
			if table, err := client.GetAllTopicConfig(ctx, broker.addr); err == nil {
				tables[slot] = table
			}
		}(index, master)
	}
	waitGroup.Wait()

	// Walking the brokers in order keeps each topic's entries sorted by broker
	// name, so the value reported as "the" configuration is always the same one.
	configs := make(map[string][]brokerTopicConfig)
	for index, table := range tables {
		for topicName, config := range table {
			if config == nil {
				continue
			}
			configs[topicName] = append(configs[topicName], brokerTopicConfig{
				broker:     masters[index],
				readQueue:  config.ReadQueueNums,
				writeQueue: config.WriteQueueNums,
				perm:       config.Perm,
				order:      config.Order,
			})
		}
	}
	return configs
}

// applyTopicConfigs copies broker-side configuration onto the list items.
// Queue counts and permission are per-broker settings, so the summary reports
// the first master's copy instead of a total that matches no single broker and
// would be wrong if fed back into an edit form.
func applyTopicConfigs(items []*model.TopicItem, configs map[string][]brokerTopicConfig) {
	for _, item := range items {
		if item == nil {
			continue
		}
		entries := configs[item.Topic]
		if len(entries) == 0 {
			continue
		}

		primary := entries[0]
		item.ReadQueue = primary.readQueue
		item.WriteQueue = primary.writeQueue
		item.Perm = model.IntToPerm(primary.perm)
		if item.Cluster == "" {
			item.Cluster = primary.broker.cluster
		}

		for _, entry := range entries {
			// Ordered delivery is a topic-level guarantee: one broker flagging
			// it is enough to label the topic FIFO.
			if entry.order {
				item.MessageType = model.MessageTypeFIFO
				break
			}
		}
	}
}

// enrichTopicMetrics fills inbound throughput and consumer-group counts, which
// need one request per topic. Workers stop picking up new topics once the
// enrichment deadline passes, so the fan-out is bounded in both width and time.
func enrichTopicMetrics(
	ctx context.Context,
	client *admin.Client,
	items []*model.TopicItem,
	configs map[string][]brokerTopicConfig,
) {
	semaphore := make(chan struct{}, enrichConcurrency)
	var waitGroup sync.WaitGroup
	for _, item := range items {
		if item == nil {
			continue
		}
		addresses := brokerAddresses(configs[item.Topic])
		if len(addresses) == 0 {
			continue
		}

		waitGroup.Add(1)
		go func(topic *model.TopicItem, addrs []string) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-semaphore }()

			topic.TpsIn = tpsOrUnknown(collectStatsTPS(ctx, client, addrs, statsTopicPutNums, topic.Topic))
			if groups, err := client.QueryTopicConsumeByWho(ctx, topic.Topic); err == nil {
				topic.ConsumerGroups = len(groups)
			}
		}(item, addresses)
	}
	waitGroup.Wait()
}

// enrichTopicDetail fills the metrics shown for a single topic. Outbound
// throughput is recorded per consumer group, so it costs one request per group
// per broker and is only worth collecting here, never for a whole list.
func (s *Service) enrichTopicDetail(client *admin.Client, item *model.TopicItem) {
	if client == nil || item == nil {
		return
	}

	addresses := make([]string, 0, len(item.Routes))
	for _, route := range item.Routes {
		if route.BrokerAddr != "" {
			addresses = append(addresses, route.BrokerAddr)
		}
	}
	if len(addresses) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
	defer cancel()

	item.TpsIn = tpsOrUnknown(collectStatsTPS(ctx, client, addresses, statsTopicPutNums, item.Topic))

	groups, err := client.QueryTopicConsumeByWho(ctx, item.Topic)
	if err != nil {
		return
	}
	item.ConsumerGroups = len(groups)
	if len(groups) == 0 {
		// No subscriber can be reading it, so zero is a measurement here.
		item.TpsOut = 0
		return
	}

	var mutex sync.Mutex
	outbound := 0.0
	answered := false

	semaphore := make(chan struct{}, enrichConcurrency)
	var waitGroup sync.WaitGroup
	for _, group := range groups {
		if group == "" {
			continue
		}
		waitGroup.Add(1)
		go func(groupName string) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-semaphore }()

			total, ok := collectStatsTPS(ctx, client, addresses, statsGroupGetNums, item.Topic+"@"+groupName)
			mutex.Lock()
			defer mutex.Unlock()
			if ok {
				answered = true
				outbound += total
			}
		}(group)
	}
	waitGroup.Wait()

	item.TpsOut = tpsOrUnknown(outbound, answered)
}

// brokerAddresses lists the brokers holding a topic, in configuration order.
func brokerAddresses(entries []brokerTopicConfig) []string {
	addresses := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.broker.addr != "" {
			addresses = append(addresses, entry.broker.addr)
		}
	}
	return addresses
}

// collectStatsTPS adds one statistics bucket across the given brokers and
// reports whether any of them answered.
func collectStatsTPS(
	ctx context.Context,
	client *admin.Client,
	addresses []string,
	statsName string,
	statsKey string,
) (float64, bool) {
	total := 0.0
	answered := false
	for _, address := range addresses {
		stats, err := client.ViewBrokerStatsData(ctx, address, statsName, statsKey)
		if err != nil {
			// A broker that never recorded this bucket answers with a business
			// error, which means no traffic rather than a failed measurement.
			var adminErr *admin.AdminError
			if errors.As(err, &adminErr) {
				answered = true
			}
			continue
		}
		if stats == nil {
			continue
		}
		answered = true
		total += stats.StatsMinute.Tps
	}
	return total, answered
}

// tpsOrUnknown rounds a sampled rate, keeping the unknown sentinel when no
// broker answered.
func tpsOrUnknown(total float64, answered bool) int {
	if !answered {
		return unknownMetric
	}
	if total <= 0 {
		return 0
	}
	return int(math.Round(total))
}
