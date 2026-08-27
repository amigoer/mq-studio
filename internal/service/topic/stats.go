package topic

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/service/internal/mqexec"
	"github.com/amigoer/mq-studio/internal/service/internal/mqoffset"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetTopicStats returns statistics for a topic.
func (s *Service) GetTopicStats(topicName string) (map[string]interface{}, error) {
	topicName = strings.TrimSpace(topicName)
	if topicName == "" {
		return nil, fmt.Errorf("获取 Topic 统计失败: Topic 名称不能为空")
	}
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var result map[string]interface{}
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		offsets, callErr := mqoffset.Collect(ctx, retryClient, topicName)
		if callErr != nil {
			return callErr
		}
		var totalMinOffset, totalMaxOffset int64
		queues := make([]map[string]interface{}, 0, len(offsets))
		for _, offset := range offsets {
			totalMinOffset += offset.MinOffset
			totalMaxOffset += offset.MaxOffset
			queues = append(queues, map[string]interface{}{
				"brokerName": offset.BrokerName,
				"queueId":    offset.QueueID,
				"minOffset":  offset.MinOffset,
				"maxOffset":  offset.MaxOffset,
				"messages":   offset.MaxOffset - offset.MinOffset,
				"lastUpdate": int64(0),
			})
		}

		sort.Slice(queues, func(i, j int) bool {
			leftBroker := queues[i]["brokerName"].(string)
			rightBroker := queues[j]["brokerName"].(string)
			if leftBroker != rightBroker {
				return leftBroker < rightBroker
			}
			return queues[i]["queueId"].(int) < queues[j]["queueId"].(int)
		})

		result = map[string]interface{}{
			"topic":          topicName,
			"queueCount":     len(queues),
			"totalMinOffset": totalMinOffset,
			"totalMaxOffset": totalMaxOffset,
			"totalMessages":  totalMaxOffset - totalMinOffset,
			"queues":         queues,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 统计失败: %w", err)
	}
	return result, nil
}
