import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import {
  cleanupPolicy,
  hasLeader,
  isInternal,
  minInsyncReplicas,
  partitionsOf,
  readableRecords,
  replicationFactor,
  topicIsHealthy,
  underReplicatedPartitions,
} from "./destinations";

const topic = (attributes: Record<string, string>, depth = 0): Destination =>
  ({
    id: 1,
    ref: { namespace: "", name: "orders" },
    partitions: 3,
    subscribers: -1,
    depth,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes,
  }) as unknown as Destination;

describe("the Kafka destination readers", () => {
  it("reads what the driver puts in the attribute map", () => {
    const source = topic({
      internal: "true",
      replicationFactor: "3",
      minInsyncReplicas: "2",
      cleanupPolicy: "compact",
    });

    expect(isInternal(source)).toBe(true);
    expect(replicationFactor(source)).toBe(3);
    expect(minInsyncReplicas(source)).toBe(2);
    expect(cleanupPolicy(source)).toBe("compact");
  });

  /*
   * The sentinel rule, which is the one a page reads wrong when it slips.
   *
   * "The cluster reported zero" and "the cluster did not report" are different
   * facts, and once both render as 0 there is no way back. A missing counter
   * has to be null so the board can draw an em dash.
   */
  it("reads an absent counter as unknown rather than as zero", () => {
    const source = topic({});
    expect(replicationFactor(source)).toBeNull();
    expect(minInsyncReplicas(source)).toBeNull();
    expect(cleanupPolicy(source)).toBe("");
  });

  it("reads the unknown depth sentinel as unknown", () => {
    expect(readableRecords(topic({}, -1))).toBeNull();
    // And a real zero stays a real zero: an empty topic has been measured.
    expect(readableRecords(topic({}, 0))).toBe(0);
  });

  // Health counters are the exception: absent means healthy, because a driver
  // that reported the topic at all walked its partitions to do so.
  it("treats an absent health counter as healthy", () => {
    expect(underReplicatedPartitions(topic({}))).toBe(0);
    expect(topicIsHealthy(topic({}))).toBe(true);
  });

  it("is unhealthy when any one of the three counters is not zero", () => {
    expect(topicIsHealthy(topic({ underReplicatedPartitions: "1" }))).toBe(false);
    expect(topicIsHealthy(topic({ offlinePartitions: "1" }))).toBe(false);
    expect(topicIsHealthy(topic({ leaderlessPartitions: "1" }))).toBe(false);
  });
});

describe("the partition rows", () => {
  it("reads the shape DestinationStats sends", () => {
    const rows = partitionsOf({
      partitions: [
        {
          partition: 0,
          leader: 1,
          leaderEpoch: 4,
          replicas: [1, 2, 3],
          isr: [1, 2],
          offlineReplicas: [3],
          startOffset: 100,
          endOffset: 400,
          records: 300,
          underReplicated: true,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partition: 0,
      leader: 1,
      replicas: [1, 2, 3],
      isr: [1, 2],
      offlineReplicas: [3],
      records: 300,
      underReplicated: true,
    });
  });

  it("survives a payload with nothing in it", () => {
    expect(partitionsOf(null)).toEqual([]);
    expect(partitionsOf({})).toEqual([]);
    expect(partitionsOf({ partitions: "not an array" })).toEqual([]);
  });

  /*
   * Leader -1 is Kafka's "no leader", and the partition is neither readable
   * nor writable while it holds. Rendering it as broker 0 would name a real
   * broker on a cluster whose ids start at zero.
   */
  it("tells no leader apart from broker zero", () => {
    const rows = partitionsOf({
      partitions: [
        { partition: 0, leader: -1 },
        { partition: 1, leader: 0 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(hasLeader(rows[0]!)).toBe(false);
    expect(hasLeader(rows[1]!)).toBe(true);
  });
});
