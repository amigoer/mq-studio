// 直接调用 admin.FetchBrokerRuntimeStats 验证 Cluster 屏幕缺数据问题。
// 用法: go run ./scripts/inspect-cluster [nameServer]
// 示例: go run ./scripts/inspect-cluster 192.168.117.2:9876
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

func main() {
	nameServer := "127.0.0.1:9876"
	if len(os.Args) > 1 && os.Args[1] != "" {
		nameServer = os.Args[1]
	}

	cli, err := admin.NewClient(admin.WithNameServers([]string{nameServer}))
	if err != nil {
		fmt.Fprintf(os.Stderr, "客户端创建失败: %v\n", err)
		os.Exit(1)
	}
	if err := cli.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "客户端启动失败: %v\n", err)
		os.Exit(1)
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. ExamineBrokerClusterInfo
	clusterInfo, err := cli.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ExamineBrokerClusterInfo 失败: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("=== Cluster Info ===")
	for clusterName, brokerNames := range clusterInfo.ClusterAddrTable {
		fmt.Printf("Cluster: %s -> %v\n", clusterName, brokerNames)
	}
	for brokerName, brokerData := range clusterInfo.BrokerAddrTable {
		fmt.Printf("Broker %s: addrs=%v\n", brokerName, brokerData.BrokerAddrs)
	}

	// 2. 对每个 master broker 调 FetchBrokerRuntimeStats
	fmt.Println("\n=== Per-Broker Runtime Stats ===")
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		masterAddr, ok := brokerData.BrokerAddrs["0"]
		if !ok {
			continue
		}
		fmt.Printf("\n>>> %s (%s)\n", brokerData.BrokerName, masterAddr)
		bctx, bcancel := context.WithTimeout(context.Background(), 5*time.Second)
		stats, err := cli.FetchBrokerRuntimeStats(bctx, masterAddr)
		bcancel()
		if err != nil {
			fmt.Printf("  ERROR: %v\n", err)
			continue
		}
		if stats == nil || stats.Table == nil {
			fmt.Println("  (empty stats)")
			continue
		}
		// 只打印我们关心的字段
		interesting := []string{
			"brokerVersionDesc",
			"putTps",
			"getTransferredTps",
			"msgPutTotalTodayNow",
			"msgGetTotalTodayNow",
			"commitLogDiskRatio",
			"consumeQueueDiskRatio",
		}
		for _, k := range interesting {
			if v, ok := stats.Table[k]; ok {
				fmt.Printf("  %-25s = %s\n", k, v)
			} else {
				fmt.Printf("  %-25s = (missing)\n", k)
			}
		}
	}

	// 3. FetchAllTopicList
	fmt.Println("\n=== Topic List ===")
	tctx, tcancel := context.WithTimeout(context.Background(), 5*time.Second)
	topicList, err := cli.FetchAllTopicList(tctx)
	tcancel()
	if err != nil {
		fmt.Printf("FetchAllTopicList 失败: %v\n", err)
	} else if topicList != nil {
		blob, _ := json.MarshalIndent(topicList.TopicList, "", "  ")
		fmt.Println(string(blob))
	}
}
