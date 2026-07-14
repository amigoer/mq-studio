// 持续向多个 Topic 灌数据，并启动一个消费者读出来，用于本地演示
// Cluster / Overview 屏幕的实时指标。
//
// 用法:
//
//	go run ./scripts/seed-data [nameServer] [duration_sec] [rate_per_sec]
//
// 示例:
//
//	go run ./scripts/seed-data 192.168.117.2:9876 60 30
//	  → 向 TestTopic / dev%test 各 30msg/s 持续 60 秒，并启动消费者
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/consumer"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

func main() {
	nameServer := "192.168.117.2:9876"
	durationSec := 60
	ratePerSec := 30

	if len(os.Args) > 1 && os.Args[1] != "" {
		nameServer = os.Args[1]
	}
	if len(os.Args) > 2 {
		if n, err := strconv.Atoi(os.Args[2]); err == nil && n > 0 {
			durationSec = n
		}
	}
	if len(os.Args) > 3 {
		if n, err := strconv.Atoi(os.Args[3]); err == nil && n > 0 {
			ratePerSec = n
		}
	}

	topics := []string{"TestTopic", "dev%test"}
	consumerGroup := "rocket-leaf-seed-consumer"

	fmt.Printf("NameServer: %s | Topics: %v | Rate: %d msg/s/topic | Duration: %ds\n",
		nameServer, topics, ratePerSec, durationSec)

	// ---- 启动消费者，让 broker 的 getTransferredTps 也有读出量 ----
	c, err := rocketmq.NewPushConsumer(
		consumer.WithGroupName(consumerGroup),
		consumer.WithNsResolver(primitive.NewPassthroughResolver([]string{nameServer})),
		consumer.WithConsumerModel(consumer.Clustering),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "创建 Consumer 失败: %v\n", err)
		os.Exit(1)
	}

	var consumed int64
	for _, topic := range topics {
		err := c.Subscribe(topic, consumer.MessageSelector{}, func(_ context.Context, msgs ...*primitive.MessageExt) (consumer.ConsumeResult, error) {
			atomic.AddInt64(&consumed, int64(len(msgs)))
			return consumer.ConsumeSuccess, nil
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "Subscribe %s 失败: %v\n", topic, err)
			os.Exit(1)
		}
	}
	if err := c.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "启动 Consumer 失败: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = c.Shutdown() }()

	// ---- 启动每个 topic 的生产者 ----
	p, err := rocketmq.NewProducer(
		producer.WithNsResolver(primitive.NewPassthroughResolver([]string{nameServer})),
		producer.WithRetry(1),
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

	deadline := time.Now().Add(time.Duration(durationSec) * time.Second)
	interval := time.Second / time.Duration(ratePerSec)

	var produced int64
	var wg sync.WaitGroup
	for _, topic := range topics {
		wg.Add(1)
		go func(topic string) {
			defer wg.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			i := 0
			for {
				if time.Now().After(deadline) {
					return
				}
				<-ticker.C
				i++
				body := fmt.Sprintf(
					`{"id":%d,"msg":"seed message #%d","topic":"%s","ts":%d}`,
					i, i, topic, time.Now().UnixMilli(),
				)
				msg := &primitive.Message{Topic: topic, Body: []byte(body)}
				msg.WithKeys([]string{fmt.Sprintf("seed-%d", i)})
				msg.WithTag(fmt.Sprintf("tag-%d", i%3))
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				_, err := p.SendSync(ctx, msg)
				cancel()
				if err != nil {
					fmt.Fprintf(os.Stderr, "[%s #%d] %v\n", topic, i, err)
					continue
				}
				atomic.AddInt64(&produced, 1)
			}
		}(topic)
	}

	// 进度打印
	progressTicker := time.NewTicker(2 * time.Second)
	defer progressTicker.Stop()
	doneCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneCh)
	}()

LOOP:
	for {
		select {
		case <-progressTicker.C:
			fmt.Printf("发送 %d | 消费 %d\n", atomic.LoadInt64(&produced), atomic.LoadInt64(&consumed))
		case <-doneCh:
			break LOOP
		}
	}

	// 等消费者再扫几秒
	time.Sleep(3 * time.Second)
	fmt.Printf("\n完成 — 总发送 %d, 总消费 %d\n",
		atomic.LoadInt64(&produced), atomic.LoadInt64(&consumed))
}
