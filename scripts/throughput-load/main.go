// Continuous produce/consume load for RocketMQ throughput testing.
// Rates jitter within ranges so overview charts look less artificial.
//
//	go run . -n 192.168.107.2:9876 -t RocketLeafE2E_1784129918814 \
//	  -produce-min 55 -produce-max 105 -consume-min 8 -consume-max 32
package main

import (
	"context"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	rocketmq "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/consumer"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

func main() {
	nameServer := flag.String("n", "192.168.107.2:9876", "NameServer address")
	topic := flag.String("t", "RocketLeafE2E_throughput", "Topic to produce/consume")
	group := flag.String("g", "RocketLeafThroughputCG", "Consumer group")
	produceMin := flag.Int("produce-min", 55, "Min produce rate (msgs/sec)")
	produceMax := flag.Int("produce-max", 105, "Max produce rate (msgs/sec)")
	consumeMin := flag.Int("consume-min", 8, "Min consume rate (msgs/sec)")
	consumeMax := flag.Int("consume-max", 32, "Max consume rate (msgs/sec); 0 max = as fast as possible")
	bodySize := flag.Int("s", 128, "Message body size in bytes")
	produceOnly := flag.Bool("produce-only", false, "Skip consumer (produce only)")
	flag.Parse()

	if *produceMin < 1 {
		*produceMin = 1
	}
	if *produceMax < *produceMin {
		*produceMax = *produceMin
	}
	if *consumeMin < 0 {
		*consumeMin = 0
	}
	if *consumeMax < *consumeMin {
		*consumeMax = *consumeMin
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	p, err := rocketmq.NewProducer(
		producer.WithNameServer([]string{*nameServer}),
		producer.WithRetry(2),
		producer.WithGroupName("RocketLeafThroughputProducer"),
		producer.WithSendMsgTimeout(5*time.Second),
	)
	if err != nil {
		fatalf("create producer: %v", err)
	}
	if err := p.Start(); err != nil {
		fatalf("start producer: %v", err)
	}
	defer p.Shutdown()

	var produced, consumed, produceErr atomic.Int64
	var produceRateNow, consumeRateNow atomic.Int64
	produceRateNow.Store(int64(mid(*produceMin, *produceMax)))
	consumeRateNow.Store(int64(mid(*consumeMin, *consumeMax)))

	body := make([]byte, *bodySize)
	for i := range body {
		body[i] = byte('A' + (i % 26))
	}

	var consumeGapNs atomic.Int64
	if *consumeMax > 0 {
		consumeGapNs.Store(int64(time.Second / time.Duration(max(1, int(consumeRateNow.Load())))))
	}
	var lastConsume atomic.Int64
	lastConsume.Store(time.Now().UnixNano())

	if !*produceOnly {
		c, err := rocketmq.NewPushConsumer(
			consumer.WithNameServer([]string{*nameServer}),
			consumer.WithGroupName(*group),
			consumer.WithConsumeFromWhere(consumer.ConsumeFromLastOffset),
			consumer.WithConsumerModel(consumer.Clustering),
			consumer.WithConsumeMessageBatchMaxSize(1),
			consumer.WithPullBatchSize(1),
		)
		if err != nil {
			fatalf("create consumer: %v", err)
		}
		err = c.Subscribe(*topic, consumer.MessageSelector{}, func(ctx context.Context, msgs ...*primitive.MessageExt) (consumer.ConsumeResult, error) {
			gap := time.Duration(consumeGapNs.Load())
			if gap <= 0 {
				consumed.Add(int64(len(msgs)))
				return consumer.ConsumeSuccess, nil
			}
			for range msgs {
				for {
					prev := lastConsume.Load()
					next := prev + int64(gap)
					now := time.Now().UnixNano()
					if now >= next {
						if lastConsume.CompareAndSwap(prev, now) {
							break
						}
						continue
					}
					wait := time.Duration(next - now)
					timer := time.NewTimer(wait)
					select {
					case <-ctx.Done():
						timer.Stop()
						return consumer.ConsumeRetryLater, ctx.Err()
					case <-timer.C:
					}
					if lastConsume.CompareAndSwap(prev, time.Now().UnixNano()) {
						break
					}
				}
				consumed.Add(1)
			}
			return consumer.ConsumeSuccess, nil
		})
		if err != nil {
			fatalf("subscribe: %v", err)
		}
		if err := c.Start(); err != nil {
			fatalf("start consumer: %v", err)
		}
		defer c.Shutdown()
		fmt.Printf("consumer started group=%s topic=%s rate=%d-%d/s\n",
			*group, *topic, *consumeMin, *consumeMax)
	}

	fmt.Printf("producing to ns=%s topic=%s produce=%d-%d/s consume=%d-%d/s body=%dB (Ctrl+C to stop)\n",
		*nameServer, *topic, *produceMin, *produceMax, *consumeMin, *consumeMax, *bodySize)

	// Periodically re-roll target rates so TPS history has natural jitter.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(1500+rand.Intn(2500)) * time.Millisecond):
				pRate := randRange(*produceMin, *produceMax)
				produceRateNow.Store(int64(pRate))
				if *consumeMax > 0 {
					cRate := randRange(max(1, *consumeMin), *consumeMax)
					consumeRateNow.Store(int64(cRate))
					consumeGapNs.Store(int64(time.Second / time.Duration(cRate)))
				}
			}
		}
	}()

	stats := time.NewTicker(2 * time.Second)
	defer stats.Stop()

	var lastP, lastC int64
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-stats.C:
				pNow := produced.Load()
				cNow := consumed.Load()
				errs := produceErr.Load()
				fmt.Printf("[%s] produced=%d (+%d/2s ≈%.0f/s target=%d) consumed=%d (+%d/2s ≈%.0f/s target=%d) errors=%d\n",
					time.Now().Format("15:04:05"),
					pNow, pNow-lastP, float64(pNow-lastP)/2, produceRateNow.Load(),
					cNow, cNow-lastC, float64(cNow-lastC)/2, consumeRateNow.Load(),
					errs,
				)
				lastP, lastC = pNow, cNow
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("stopped. total produced=%d consumed=%d errors=%d\n",
				produced.Load(), consumed.Load(), produceErr.Load())
			return
		default:
		}

		rate := int(produceRateNow.Load())
		if rate < 1 {
			rate = 1
		}
		// Per-message jitter (~±25%) so samples within a second aren't perfectly even.
		jitter := 0.75 + rand.Float64()*0.5
		interval := time.Duration(float64(time.Second) / float64(rate) * jitter)
		if interval < time.Millisecond {
			interval = time.Millisecond
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			fmt.Printf("stopped. total produced=%d consumed=%d errors=%d\n",
				produced.Load(), consumed.Load(), produceErr.Load())
			return
		case <-timer.C:
		}

		msg := &primitive.Message{Topic: *topic, Body: body}
		msg.WithTag("throughput")
		sendCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_, err := p.SendSync(sendCtx, msg)
		cancel()
		if err != nil {
			produceErr.Add(1)
			continue
		}
		produced.Add(1)
	}
}

func randRange(min, max int) int {
	if max <= min {
		return min
	}
	return min + rand.Intn(max-min+1)
}

func mid(a, b int) int {
	return a + (b-a)/2
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
