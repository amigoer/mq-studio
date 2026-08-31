package kafka

import (
	"context"
	"sort"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

// NodeConfig reads one broker's effective settings.
//
// Effective, not configured: a broker reports what it is running with, which
// is not always what its properties file says. The address is what ListNodes
// gave the node, and the broker id behind it is what the protocol wants.
func (c *Conn) NodeConfig(ctx context.Context, address string) (map[string]string, error) {
	node, err := c.NodeDetail(ctx, address)
	if err != nil {
		return nil, err
	}
	resources, err := c.admin.DescribeBrokerConfigs(ctx, int32(node.ID))
	if err != nil {
		return nil, err
	}
	for _, resource := range resources {
		if resource.Err != nil {
			return nil, resource.Err
		}
		return flattenConfigs(resource.Configs), nil
	}
	return map[string]string{}, nil
}

// DirectoryConfig is empty on Kafka.
//
// KRaft's controllers are brokers of the cluster rather than a separate
// discovery tier, and there is no ZooKeeper to ask when they are not. An empty
// map is the honest answer - "there is no such tier" - rather than repeating
// the broker settings under a second name.
func (c *Conn) DirectoryConfig(context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}

// LogDirs reports how much disk every broker's partitions are taking.
//
// One request to every broker, so it is the cluster page's own call and never
// part of a listing.
func (c *Conn) LogDirs(ctx context.Context) ([]*model.LogDirSummary, error) {
	described, err := c.admin.DescribeAllLogDirs(ctx, nil)
	if err != nil {
		return nil, err
	}

	dirs := make([]*model.LogDirSummary, 0)
	described.Each(func(dir kadm.DescribedLogDir) {
		summary := &model.LogDirSummary{Broker: dir.Broker, Path: dir.Dir}
		if dir.Err != nil {
			summary.Err = dir.Err.Error()
			dirs = append(dirs, summary)
			return
		}
		dir.Topics.Each(func(partition kadm.DescribedLogDirPartition) {
			summary.Partitions++
			summary.Size += partition.Size
			if partition.OffsetLag > 0 {
				summary.OffsetLag += partition.OffsetLag
			}
		})
		dirs = append(dirs, summary)
	})

	sort.Slice(dirs, func(i, j int) bool {
		if dirs[i].Broker != dirs[j].Broker {
			return dirs[i].Broker < dirs[j].Broker
		}
		return dirs[i].Path < dirs[j].Path
	})
	return dirs, nil
}

// LogDirPartitions reports the partitions inside the directories, largest
// first: the reason to open this page is to find what is filling a disk.
func (c *Conn) LogDirPartitions(ctx context.Context, limit int) ([]*model.LogDirPartition, error) {
	described, err := c.admin.DescribeAllLogDirs(ctx, nil)
	if err != nil {
		return nil, err
	}

	partitions := make([]*model.LogDirPartition, 0)
	described.Each(func(dir kadm.DescribedLogDir) {
		if dir.Err != nil {
			return
		}
		dir.Topics.Each(func(partition kadm.DescribedLogDirPartition) {
			partitions = append(partitions, &model.LogDirPartition{
				Broker:    partition.Broker,
				Dir:       partition.Dir,
				Topic:     partition.Topic,
				Partition: partition.Partition,
				Size:      partition.Size,
				OffsetLag: partition.OffsetLag,
				IsFuture:  partition.IsFuture,
			})
		})
	})

	sort.Slice(partitions, func(i, j int) bool {
		if partitions[i].Size != partitions[j].Size {
			return partitions[i].Size > partitions[j].Size
		}
		if partitions[i].Topic != partitions[j].Topic {
			return partitions[i].Topic < partitions[j].Topic
		}
		return partitions[i].Partition < partitions[j].Partition
	})
	if limit > 0 && len(partitions) > limit {
		partitions = partitions[:limit]
	}
	return partitions, nil
}
