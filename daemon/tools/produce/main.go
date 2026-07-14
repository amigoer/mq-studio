// 向指定 NameServer 发送测试消息，用于本地调试/加数据
// 用法: go run ./scripts/produce [nameServer] [topic] [count]
// 示例: go run ./scripts/produce 192.168.117.2:9876 TestTopic 20
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

func main() {
	nameServer := "192.168.117.2:9876"
	topic := "TestTopic"
	count := 20

	if len(os.Args) > 1 && os.Args[1] != "" {
		nameServer = os.Args[1]
	}
	if len(os.Args) > 2 && os.Args[2] != "" {
		topic = os.Args[2]
	}
	if len(os.Args) > 3 {
		if n, err := strconv.Atoi(os.Args[3]); err == nil && n > 0 {
			count = n
		}
	}

	fmt.Printf("NameServer: %s, Topic: %s, 发送条数: %d\n", nameServer, topic, count)

	p, err := rocketmq.NewProducer(
		producer.WithNsResolver(primitive.NewPassthroughResolver([]string{nameServer})),
		producer.WithRetry(2),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "创建 Producer 失败: %v\n", err)
		os.Exit(1)
	}

	if err := p.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "启动 Producer 失败: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = p.Shutdown() }()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	sent, failed := 0, 0
	for i := 0; i < count; i++ {
		body := fmt.Sprintf(`{"id":%d,"msg":"Rocket-Leaf 测试消息 #%d","ts":%d}`,
			i+1, i+1, time.Now().UnixMilli())
		msg := &primitive.Message{
			Topic: topic,
			Body:  []byte(body),
		}
		msg.WithKeys([]string{fmt.Sprintf("key-%d", i+1)})
		msg.WithTag(fmt.Sprintf("tag-%d", i%3)) // tag-0, tag-1, tag-2 轮换

		res, err := p.SendSync(ctx, msg)
		if err != nil {
			failed++
			fmt.Fprintf(os.Stderr, "[%d] 发送失败: %v\n", i+1, err)
			continue
		}
		sent++
		fmt.Printf("[%d] 发送成功 msgId=%s\n", i+1, res.MsgID)
	}

	fmt.Printf("\n完成: 成功 %d, 失败 %d\n", sent, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
