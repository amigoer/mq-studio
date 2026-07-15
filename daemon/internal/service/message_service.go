package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
	rocketmqClient "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

// MessageService 消息查询服务
type MessageService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewMessageService 创建消息查询服务
func NewMessageService(settingsService *SettingsService) *MessageService {
	return &MessageService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *MessageService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// QueryMessages 查询消息，startTime/endTime 为 Unix 毫秒时间戳，0 表示不限制
func (s *MessageService) QueryMessages(topic string, key string, tag string, maxResults int, startTime, endTime int64) ([]*model.MessageItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	topic = strings.TrimSpace(topic)
	if topic == "" {
		return nil, fmt.Errorf("查询消息失败: Topic 不能为空")
	}
	if maxResults <= 0 {
		maxResults = s.settingsService.GetFetchLimit()
	}
	if maxResults > 1000 {
		maxResults = 1000
	}
	if endTime <= 0 {
		endTime = time.Now().UnixMilli()
	}
	if startTime < 0 {
		startTime = 0
	}
	if startTime > endTime {
		return nil, fmt.Errorf("查询消息失败: 开始时间不能晚于结束时间")
	}

	result := make([]*model.MessageItem, 0)
	trimmedKey := strings.TrimSpace(key)
	trimmedTag := strings.TrimSpace(tag)

	queryTimeout := s.settingsService.GetRequestTimeout()
	if queryTimeout < 30*time.Second {
		queryTimeout = 30 * time.Second
	}
	err = executeWithClientRetryTimeout(client, queryTimeout, func(ctx context.Context, retryClient *admin.Client) error {
		var (
			msgs    []*admin.MessageExt
			callErr error
		)
		if trimmedKey != "" && trimmedTag == "" {
			// 仅按 Key 查询时使用 Broker 索引。
			msgs, callErr = retryClient.QueryMessage(ctx, topic, trimmedKey, maxResults, startTime, endTime)
			if callErr == nil && len(msgs) == 0 {
				// 新写入消息的哈希索引存在短暂可见性延迟；索引未命中时
				// 扫描时间窗内的队列并做精确 Key 匹配，避免返回假空结果。
				msgs, callErr = queryMessagesNewest(
					ctx, retryClient, topic, trimmedKey, "", maxResults, startTime, endTime,
				)
			}
		} else {
			// 无 Key 或同时带 Tag 时按队列从后向前扫描。底层 QueryMessageByTime
			// 从时间窗起点返回最早一批，既不符合“最新消息”预期，也会让本地过滤漏报。
			msgs, callErr = queryMessagesNewest(ctx, retryClient, topic, trimmedKey, trimmedTag, maxResults, startTime, endTime)
		}
		if callErr != nil {
			return callErr
		}

		tmpResult := make([]*model.MessageItem, 0, len(msgs))
		seen := make(map[string]struct{}, len(msgs))
		for _, msg := range msgs {
			if msg == nil || msg.StoreTimestamp < startTime || msg.StoreTimestamp > endTime {
				continue
			}
			dedupeKey := msg.MsgId
			if dedupeKey == "" {
				dedupeKey = fmt.Sprintf("%s|%s|%d|%d|%d", msg.Topic, msg.StoreHost, msg.QueueId, msg.QueueOffset, msg.StoreTimestamp)
			}
			if _, exists := seen[dedupeKey]; exists {
				continue
			}
			if trimmedKey != "" {
				msgKeys, _ := msg.Properties["KEYS"]
				if !containsExactMessageKey(msgKeys, trimmedKey) {
					continue
				}
			}
			if trimmedTag != "" {
				msgTags, _ := msg.Properties["TAGS"]
				if strings.TrimSpace(msgTags) != trimmedTag {
					continue
				}
			}
			seen[dedupeKey] = struct{}{}
			tmpResult = append(tmpResult, s.convertMessageExt(msg))
		}
		sort.Slice(tmpResult, func(i, j int) bool {
			return tmpResult[i].StoreTimestamp > tmpResult[j].StoreTimestamp
		})
		if len(tmpResult) > maxResults {
			tmpResult = tmpResult[:maxResults]
		}

		result = tmpResult
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}

	return result, nil
}

type messageQueueScan struct {
	brokerAddr string
	queueID    int
}

// queryMessagesNewest 从每个读队列的时间窗末端向前扫描，直到该队列找到足够
// 的匹配消息或到达时间窗起点。每个队列最多保留 maxResults 条，因此合并后取
// 全局最新 maxResults 条时不会漏掉候选；扫描超时会返回错误而不是伪装成空结果。
func queryMessagesNewest(
	ctx context.Context,
	client *admin.Client,
	topic, wantedKey, wantedTag string,
	maxResults int,
	startTime, endTime int64,
) ([]*admin.MessageExt, error) {
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	if route == nil {
		return nil, fmt.Errorf("Topic 路由为空")
	}

	brokerAddrs := make(map[string]string, len(route.BrokerDatas))
	for _, broker := range route.BrokerDatas {
		if broker == nil {
			continue
		}
		addr := broker.BrokerAddrs["0"]
		if addr == "" {
			for _, candidate := range broker.BrokerAddrs {
				if candidate != "" {
					addr = candidate
					break
				}
			}
		}
		if addr != "" {
			brokerAddrs[broker.BrokerName] = addr
		}
	}

	queues := make([]messageQueueScan, 0)
	for _, queueData := range route.QueueDatas {
		if queueData == nil || queueData.ReadQueueNums <= 0 {
			continue
		}
		addr := brokerAddrs[queueData.BrokerName]
		if addr == "" {
			continue
		}
		for queueID := 0; queueID < queueData.ReadQueueNums; queueID++ {
			queues = append(queues, messageQueueScan{brokerAddr: addr, queueID: queueID})
		}
	}
	if len(queues) == 0 {
		return nil, fmt.Errorf("未找到可读消息队列")
	}

	type scanResult struct {
		messages []*admin.MessageExt
		err      error
	}
	results := make([]scanResult, len(queues))
	semaphore := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for index, queue := range queues {
		wg.Add(1)
		go func(i int, q messageQueueScan) {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[i].err = ctx.Err()
				return
			}
			results[i].messages, results[i].err = scanMessageQueueNewest(
				ctx, client, q, topic, wantedKey, wantedTag, maxResults, startTime, endTime,
			)
		}(index, queue)
	}
	wg.Wait()

	all := make([]*admin.MessageExt, 0, maxResults*len(queues))
	for _, result := range results {
		if result.err != nil {
			return nil, result.err
		}
		all = append(all, result.messages...)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].StoreTimestamp > all[j].StoreTimestamp
	})
	if len(all) > maxResults {
		all = all[:maxResults]
	}
	return all, nil
}

func scanMessageQueueNewest(
	ctx context.Context,
	client *admin.Client,
	queue messageQueueScan,
	topic, wantedKey, wantedTag string,
	maxResults int,
	startTime, endTime int64,
) ([]*admin.MessageExt, error) {
	startOffset, err := client.SearchOffset(ctx, queue.brokerAddr, topic, queue.queueID, startTime)
	if err != nil {
		return nil, err
	}
	endOffset, err := client.SearchOffset(ctx, queue.brokerAddr, topic, queue.queueID, endTime)
	if err != nil {
		return nil, err
	}
	if endOffset < startOffset {
		return []*admin.MessageExt{}, nil
	}

	// SearchOffset 返回目标时间附近的偏移；+1 后可覆盖恰好等于 endTime 的消息，
	// 最终仍由时间戳过滤保证边界准确。
	upper := endOffset + 1
	matches := make([]*admin.MessageExt, 0, maxResults)
	for upper > startOffset && len(matches) < maxResults {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lower := upper - 32
		if lower < startOffset {
			lower = startOffset
		}
		batchSize := int(upper - lower)
		if batchSize <= 0 {
			break
		}
		pulled, pullErr := client.PullMessage(ctx, queue.brokerAddr, topic, queue.queueID, lower, batchSize)
		if pullErr != nil {
			return nil, pullErr
		}
		if pulled == nil {
			return nil, fmt.Errorf("Broker 返回空拉取结果")
		}
		for _, msg := range pulled.Messages {
			if msg == nil || msg.QueueOffset < lower || msg.QueueOffset >= upper ||
				msg.StoreTimestamp < startTime || msg.StoreTimestamp > endTime {
				continue
			}
			if wantedKey != "" && !containsExactMessageKey(msg.Properties["KEYS"], wantedKey) {
				continue
			}
			if wantedTag != "" && strings.TrimSpace(msg.Properties["TAGS"]) != wantedTag {
				continue
			}
			matches = append(matches, msg)
		}
		upper = lower
	}
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].StoreTimestamp > matches[j].StoreTimestamp
	})
	if len(matches) > maxResults {
		matches = matches[:maxResults]
	}
	return matches, nil
}

func containsExactMessageKey(rawKeys, wanted string) bool {
	for _, key := range strings.Fields(rawKeys) {
		if key == wanted {
			return true
		}
	}
	return false
}

// convertMessageExt 将 admin.MessageExt 转换为 model.MessageItem
func (s *MessageService) convertMessageExt(msg *admin.MessageExt) *model.MessageItem {
	tags := ""
	keys := ""
	retryTimes := 0
	if msg.Properties != nil {
		if t, ok := msg.Properties["TAGS"]; ok {
			tags = t
		}
		if k, ok := msg.Properties["KEYS"]; ok {
			keys = k
		}
		if raw, ok := msg.Properties[primitive.PropertyReconsumeTime]; ok {
			retryTimes, _ = strconv.Atoi(raw)
		}
	}
	status := model.MsgNormal
	if strings.HasPrefix(msg.Topic, "%DLQ%") || strings.HasPrefix(msg.Topic, "DLQ%") {
		status = model.MsgDLQ
	} else if strings.HasPrefix(msg.Topic, "%RETRY%") || strings.HasPrefix(msg.Topic, "RETRY%") {
		status = model.MsgRetry
	}
	messageID := strings.TrimSpace(msg.MsgId)
	if messageID == "" {
		messageID = msg.OffsetMsgId
	}

	return &model.MessageItem{
		ID:             s.getNextID(),
		Topic:          msg.Topic,
		MessageID:      messageID,
		Tags:           tags,
		Keys:           keys,
		QueueID:        msg.QueueId,
		QueueOffset:    msg.QueueOffset,
		StoreHost:      msg.StoreHost,
		BornHost:       msg.BornHost,
		StoreTime:      time.Unix(msg.StoreTimestamp/1000, 0).Format("2006-01-02 15:04:05"),
		StoreTimestamp: msg.StoreTimestamp,
		Body:           string(msg.Body),
		Properties:     msg.Properties,
		Status:         status,
		RetryTimes:     retryTimes,
	}
}

// QueryMessageByID 按消息 ID 查询消息
func (s *MessageService) QueryMessageByID(topic string, msgID string) (*model.MessageItem, error) {
	topic = strings.TrimSpace(topic)
	msgID = strings.TrimSpace(msgID)
	if topic == "" || msgID == "" {
		return nil, fmt.Errorf("查询消息失败: Topic 和 Message ID 不能为空")
	}
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var item *model.MessageItem
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		msg, viewErr := retryClient.ViewMessage(ctx, topic, msgID)
		if viewErr == nil && msg != nil {
			item = s.convertMessageExt(msg)
			return nil
		}

		// RocketMQ 5 的 ViewMessageById 使用 OffsetMsgID 定位，而部分旧管理
		// 客户端仍发送 msgId 请求头。直接查看失败时按客户端 MsgID（UNIQ_KEY）
		// 查询 Broker 索引，兼容两种服务端行为。
		messages, queryErr := retryClient.QueryMessage(ctx, topic, msgID, 64, 0, time.Now().UnixMilli())
		if queryErr != nil {
			if viewErr != nil {
				return fmt.Errorf("直接查看失败: %v；索引回查失败: %w", viewErr, queryErr)
			}
			return queryErr
		}
		for _, candidate := range messages {
			if messageMatchesID(candidate, msgID) {
				item = s.convertMessageExt(candidate)
				return nil
			}
		}

		// RocketMQ 5 的消息索引在新消息写入后可能暂时不可见。管理界面的
		// 详情入口通常来自最近消息列表，因此扫描各队列最近 1000 条作为
		// 最后一层兼容兜底，并同时支持客户端 MsgID 与 OffsetMsgID。
		recent, scanErr := queryMessagesNewest(
			ctx, retryClient, topic, "", "", 1000, 0, time.Now().UnixMilli(),
		)
		if scanErr != nil {
			return fmt.Errorf("未找到消息: %s；最近消息扫描失败: %w", msgID, scanErr)
		}
		for _, candidate := range recent {
			if messageMatchesID(candidate, msgID) {
				item = s.convertMessageExt(candidate)
				return nil
			}
		}
		return fmt.Errorf("未找到消息: %s", msgID)
	})
	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}

	return item, nil
}

func messageMatchesID(message *admin.MessageExt, messageID string) bool {
	if message == nil {
		return false
	}
	if message.MsgId == messageID || message.OffsetMsgId == messageID {
		return true
	}
	return message.Properties[primitive.PropertyUniqueClientMessageIdKeyIndex] == messageID
}

// GetMessageTrack 获取消息轨迹
// 通过查询订阅该 Topic 的消费者组，逐一检查消费进度来判断消息是否已被消费
func (s *MessageService) GetMessageTrack(topic string, msgID string) ([]*model.MessageTrackItem, error) {
	topic = strings.TrimSpace(topic)
	msgID = strings.TrimSpace(msgID)
	if topic == "" || msgID == "" {
		return nil, fmt.Errorf("查询消息轨迹失败: Topic 和 Message ID 不能为空")
	}
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var message *admin.MessageExt
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		message, callErr = retryClient.ViewMessage(ctx, topic, msgID)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("查询目标消息失败: %w", err)
	}
	if message == nil {
		return nil, fmt.Errorf("查询目标消息失败: 消息不存在")
	}
	if message.BrokerName == "" {
		message.BrokerName = s.resolveMessageBrokerName(client, message)
	}

	// 1. 获取订阅该 Topic 的所有消费者组
	var groups []string
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		result, callErr := retryClient.QueryTopicConsumeByWho(ctx, topic)
		if callErr != nil {
			return callErr
		}
		groups = result
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("查询消费者组失败: %w", err)
	}

	tracks := make([]*model.MessageTrackItem, 0, len(groups))

	// 2. 逐个消费者组检查消费状态
	for _, group := range groups {
		if isSystemGroup(group) {
			continue
		}

		track := &model.MessageTrackItem{
			ConsumerGroup: group,
			TrackType:     "UNKNOWN",
			ConsumeStatus: "未知",
		}

		err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			stats, statsErr := retryClient.ExamineConsumeStats(ctx, group)
			if statsErr != nil {
				return statsErr
			}

			var targetOffset *admin.OffsetWrapper
			for mqKey, offset := range stats.OffsetTable {
				if offset != nil && matchesMessageQueueKey(mqKey, message.Topic, message.BrokerName, message.QueueId) {
					targetOffset = offset
					break
				}
			}
			if targetOffset == nil {
				track.TrackType = "NOT_CONSUME_YET"
				track.ConsumeStatus = "未找到该消息队列的消费位点"
			} else if targetOffset.ConsumerOffset > message.QueueOffset {
				track.TrackType = "CONSUMED"
				track.ConsumeStatus = "已消费"
			} else {
				track.TrackType = "NOT_CONSUME_YET"
				track.ConsumeStatus = "未消费"
			}

			return nil
		})
		if err != nil {
			track.TrackType = "UNKNOWN"
			track.ConsumeStatus = "无法获取消费进度"
			track.ExceptionDesc = err.Error()
		}

		tracks = append(tracks, track)
	}

	return tracks, nil
}

func (s *MessageService) resolveMessageBrokerName(client *admin.Client, msg *admin.MessageExt) string {
	if msg == nil {
		return ""
	}
	var brokerName string
	_ = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		route, err := retryClient.ExamineTopicRouteInfo(ctx, msg.Topic)
		if err != nil {
			return err
		}
		storeHost := strings.TrimPrefix(strings.TrimSpace(msg.StoreHost), "/")
		for _, broker := range route.BrokerDatas {
			if broker == nil {
				continue
			}
			for _, addr := range broker.BrokerAddrs {
				if strings.TrimPrefix(strings.TrimSpace(addr), "/") == storeHost {
					brokerName = broker.BrokerName
					return nil
				}
			}
		}
		return nil
	})
	return brokerName
}

func matchesMessageQueueKey(key, topic, brokerName string, queueID int) bool {
	var parsed struct {
		Topic      string `json:"topic"`
		BrokerName string `json:"brokerName"`
		QueueID    int    `json:"queueId"`
	}
	if json.Unmarshal([]byte(key), &parsed) == nil && parsed.Topic != "" {
		return parsed.Topic == topic && parsed.QueueID == queueID &&
			(brokerName == "" || parsed.BrokerName == brokerName)
	}
	if strings.Contains(key, "topic=") {
		return extractQueueKeyField(key, "topic") == topic &&
			extractQueueKeyField(key, "queueId") == fmt.Sprintf("%d", queueID) &&
			(brokerName == "" || extractQueueKeyField(key, "brokerName") == brokerName)
	}
	queueSuffix := fmt.Sprintf("-%d", queueID)
	if brokerName == "" {
		return strings.HasPrefix(key, topic+"-") && strings.HasSuffix(key, queueSuffix)
	}
	return key == fmt.Sprintf("%s-%s-%d", topic, brokerName, queueID)
}

func extractQueueKeyField(key, field string) string {
	marker := field + "="
	idx := strings.Index(key, marker)
	if idx < 0 {
		return ""
	}
	value := key[idx+len(marker):]
	if end := strings.IndexAny(value, ",]"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

// ResendMessage 将原消息内容作为新消息重新发布。
func (s *MessageService) ResendMessage(consumerGroup string, clientID string, topic string, msgID string) (string, error) {
	// 保留旧绑定参数以兼容现有前端；真正的“重投”是重新发布原消息，
	// 不再误用必须依赖在线 clientID 的 ConsumeMessageDirectly。
	_ = consumerGroup
	_ = clientID
	item, err := s.QueryMessageByID(topic, msgID)
	if err != nil {
		return "", fmt.Errorf("读取原消息失败: %w", err)
	}
	targetTopic := item.Topic
	if item.Properties != nil {
		if original := strings.TrimSpace(item.Properties[primitive.PropertyRetryTopic]); original != "" {
			targetTopic = original
		} else if original := strings.TrimSpace(item.Properties[primitive.PropertyRealTopic]); original != "" {
			targetTopic = original
		}
	}
	if strings.HasPrefix(targetTopic, "%DLQ%") || strings.HasPrefix(targetTopic, "%RETRY%") ||
		strings.HasPrefix(targetTopic, "DLQ%") || strings.HasPrefix(targetTopic, "RETRY%") {
		return "", fmt.Errorf("无法从内部 Topic %s 解析原业务 Topic", targetTopic)
	}
	return s.SendMessage(targetTopic, item.Tags, item.Keys, item.Body, 0)
}

// QueryDLQMessages 查询消费者组的死信队列消息。
// 当 DLQ Topic 还未被创建（说明这个组从未产生过死信）时，返回空列表而非报错。
func (s *MessageService) QueryDLQMessages(groupName string, maxResults int) ([]*model.MessageItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("查询死信消息失败: 消费者组不能为空")
	}
	dlqTopic := "%DLQ%" + groupName
	msgs, err := s.QueryMessages(dlqTopic, "", "", maxResults, 0, 0)
	if err != nil && errors.Is(err, admin.ErrTopicNotFound) {
		return []*model.MessageItem{}, nil
	}
	return msgs, err
}

// QueryRetryMessages 查询消费者组的重试队列消息。
// 当重试 Topic 还未被创建（说明这个组从未产生过重试）时，返回空列表而非报错。
func (s *MessageService) QueryRetryMessages(groupName string, maxResults int) ([]*model.MessageItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("查询重试消息失败: 消费者组不能为空")
	}
	retryTopic := "%RETRY%" + groupName
	msgs, err := s.QueryMessages(retryTopic, "", "", maxResults, 0, 0)
	if err != nil && errors.Is(err, admin.ErrTopicNotFound) {
		return []*model.MessageItem{}, nil
	}
	return msgs, err
}

// SendMessage 发送消息到指定 Topic，delayLevel 0 表示不延迟，1-18 对应 RocketMQ 延迟等级
func (s *MessageService) SendMessage(topic string, tags string, keys string, body string, delayLevel int) (string, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return "", fmt.Errorf("发送消息失败: Topic 不能为空")
	}
	if strings.TrimSpace(body) == "" {
		return "", fmt.Errorf("发送消息失败: 消息体不能为空")
	}
	if delayLevel < 0 || delayLevel > 18 {
		return "", fmt.Errorf("发送消息失败: 延迟等级必须在 0-18 之间")
	}

	// 获取默认连接的 NameServer 地址
	manager := rocketmq.GetClientManager()
	if _, err := manager.GetDefaultClient(); err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}
	clientConfig, err := manager.GetDefaultClientConfig()
	if err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}

	// 创建 Producer
	producerOptions := []producer.Option{
		producer.WithNameServer(clientConfig.NameServers),
		producer.WithRetry(2),
		producer.WithSendMsgTimeout(s.settingsService.GetRequestTimeout()),
	}
	if clientConfig.EnableACL {
		producerOptions = append(producerOptions, producer.WithCredentials(primitive.Credentials{
			AccessKey: clientConfig.AccessKey,
			SecretKey: clientConfig.SecretKey,
		}))
	}
	p, err := rocketmqClient.NewProducer(producerOptions...)
	if err != nil {
		return "", fmt.Errorf("创建 Producer 失败: %w", err)
	}

	if err := p.Start(); err != nil {
		return "", fmt.Errorf("启动 Producer 失败: %w", err)
	}
	defer p.Shutdown()

	msg := &primitive.Message{
		Topic: topic,
		Body:  []byte(body),
	}
	if tags != "" {
		msg.WithTag(tags)
	}
	if keys != "" {
		msg.WithKeys([]string{keys})
	}
	if delayLevel > 0 {
		msg.WithDelayTimeLevel(delayLevel)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()
	result, err := p.SendSync(ctx, msg)
	if err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}

	// HTTP 契约返回 RocketMQ 标准客户端 MsgID；成功文案由桌面端展示。
	messageID := strings.TrimSpace(result.MsgID)
	if messageID == "" {
		messageID = result.OffsetMsgID
	}
	return messageID, nil
}
