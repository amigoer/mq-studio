package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

type messageQuery struct {
	topic      string
	key        string
	tag        string
	maxResults int
	startTime  int64
	endTime    int64
}

// normalizeMessageQuery performs deterministic input normalization and validation.
func normalizeMessageQuery(
	topic, key, tag string,
	maxResults int,
	startTime, endTime int64,
	defaultLimit int,
	nowMillis int64,
) (messageQuery, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return messageQuery{}, fmt.Errorf("查询消息失败: Topic 不能为空")
	}
	if maxResults <= 0 {
		maxResults = defaultLimit
	}
	if maxResults > 1000 {
		maxResults = 1000
	}
	if endTime <= 0 {
		endTime = nowMillis
	}
	if startTime < 0 {
		startTime = 0
	}
	if startTime > endTime {
		return messageQuery{}, fmt.Errorf("查询消息失败: 开始时间不能晚于结束时间")
	}
	return messageQuery{
		topic:      topic,
		key:        strings.TrimSpace(key),
		tag:        strings.TrimSpace(tag),
		maxResults: maxResults,
		startTime:  startTime,
		endTime:    endTime,
	}, nil
}

// QueryMessages queries messages within a millisecond timestamp range. Zero
// boundaries are unrestricted and non-positive limits use the configured default.
func (c *Conn) queryMessagesBy(ctx context.Context, topic, key, tag string, maxResults int, startTime, endTime int64) ([]*model.MessageItem, error) {
	defaultLimit := maxResults
	if maxResults <= 0 {
		defaultLimit = defaultFetchLimit
	}
	query, err := normalizeMessageQuery(
		topic, key, tag, maxResults, startTime, endTime, defaultLimit, time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, err
	}

	result := make([]*model.MessageItem, 0)
	queryTimeout := timeoutFrom(ctx)
	if queryTimeout < 30*time.Second {
		queryTimeout = 30 * time.Second
	}
	err = c.execWithTimeout(queryTimeout, func(ctx context.Context, retryClient *admin.Client) error {
		messages, callErr := executeMessageQuery(ctx, retryClient, query)
		if callErr != nil {
			return callErr
		}
		result = c.convertQueryResults(messages, query)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}
	return result, nil
}

func executeMessageQuery(ctx context.Context, client *admin.Client, query messageQuery) ([]*admin.MessageExt, error) {
	if query.key != "" && query.tag == "" {
		// Use the broker index for key-only queries and scan queues if the index is not visible yet.
		messages, err := client.QueryMessage(
			ctx, query.topic, query.key, query.maxResults, query.startTime, query.endTime,
		)
		if err == nil && len(messages) == 0 {
			return queryMessagesNewest(
				ctx, client, query.topic, query.key, "", query.maxResults, query.startTime, query.endTime,
			)
		}
		return messages, err
	}
	// Queue scans preserve newest-first semantics for unindexed and tag-filtered queries.
	return queryMessagesNewest(
		ctx, client, query.topic, query.key, query.tag, query.maxResults, query.startTime, query.endTime,
	)
}

func (c *Conn) convertQueryResults(messages []*admin.MessageExt, query messageQuery) []*model.MessageItem {
	result := make([]*model.MessageItem, 0, len(messages))
	seen := make(map[string]struct{}, len(messages))
	for _, message := range messages {
		if message == nil || message.StoreTimestamp < query.startTime || message.StoreTimestamp > query.endTime {
			continue
		}
		dedupeKey := message.MsgId
		if dedupeKey == "" {
			dedupeKey = fmt.Sprintf(
				"%s|%s|%d|%d|%d",
				message.Topic,
				message.StoreHost,
				message.QueueId,
				message.QueueOffset,
				message.StoreTimestamp,
			)
		}
		if _, exists := seen[dedupeKey]; exists {
			continue
		}
		if query.key != "" && !containsExactMessageKey(message.Properties["KEYS"], query.key) {
			continue
		}
		if query.tag != "" && strings.TrimSpace(message.Properties["TAGS"]) != query.tag {
			continue
		}
		seen[dedupeKey] = struct{}{}
		result = append(result, c.convertMessageExt(message))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].StoreTimestamp > result[j].StoreTimestamp
	})
	if len(result) > query.maxResults {
		result = result[:query.maxResults]
	}
	return result
}
