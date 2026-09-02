import { describe, expect, it } from "vitest";
import { Destination, DestinationRef } from "@bindings/model/models";
import {
  isPartitioned,
  isPersistent,
  parsePartitions,
  reported,
  storageBytes,
  topicURL,
  validateTopicName,
} from "./destinations";

const t = (key: string) => key;

const topic = (
  name: string,
  attributes: Record<string, string> = {},
  partitions = 0,
): Destination =>
  new Destination({
    ref: new DestinationRef({ namespace: "public/default", name }),
    partitions,
    attributes,
  });

/*
 * Persistence is part of every address the driver builds, so reading it wrong
 * addresses a topic that does not exist.
 *
 * It defaults to persistent because that is what an absent attribute means on
 * every other path: the driver only writes "false" for a non-persistent topic.
 */
describe("a topic's storage", () => {
  it("defaults to persistent when the driver said nothing", () => {
    expect(isPersistent(topic("orders"))).toBe(true);
  });

  it("reads the non-persistent marker", () => {
    expect(isPersistent(topic("telemetry", { pulsarPersistent: "false" }))).toBe(false);
  });

  it("builds the address Pulsar's own tooling would use", () => {
    expect(topicURL(topic("orders"))).toBe("persistent://public/default/orders");
    expect(topicURL(topic("telemetry", { pulsarPersistent: "false" }))).toBe(
      "non-persistent://public/default/telemetry",
    );
  });
});

/*
 * Partitioned is a shape, not a count.
 *
 * A non-partitioned topic can never become partitioned; a partitioned one with
 * a single partition is addressed as name-partition-0 and can grow. The column
 * has to tell them apart because it decides what an operator can do next.
 */
describe("whether a topic is partitioned", () => {
  it("is false for a topic created without partitions", () => {
    expect(isPartitioned(topic("audit", {}, 0))).toBe(false);
  });

  it("is true for one with a single partition", () => {
    expect(isPartitioned(topic("orders", {}, 1))).toBe(true);
  });

  // The driver's unknown sentinel is not a partition count of -1.
  it("is false for a topic whose stats were never read", () => {
    expect(isPartitioned(topic("orders", {}, -1))).toBe(false);
    expect(reported(-1)).toBeNull();
    expect(reported(0)).toBe(0);
  });
});

// A figure the driver did not report reads as absent, so the page can draw a
// dash rather than claiming the topic occupies nothing.
describe("a figure the driver did not report", () => {
  it("reads as null rather than zero", () => {
    expect(storageBytes(topic("orders"))).toBeNull();
    expect(storageBytes(topic("orders", { pulsarStorageBytes: "0" }))).toBe(0);
    expect(storageBytes(topic("orders", { pulsarStorageBytes: "4096" }))).toBe(4096);
  });
});

/*
 * The form catches what Pulsar would refuse, so the message names the field.
 *
 * The last case is the one worth having: a topic literally named
 * "orders-partition-0" shadows a real partition of a topic called "orders",
 * and once created it cannot be reached through its parent.
 */
describe("what the topic form refuses", () => {
  it("needs a name", () => {
    expect(validateTopicName("", t)).toBe("board.topics.pulsar.nameRequired");
    expect(validateTopicName("   ", t)).toBe("board.topics.pulsar.nameRequired");
  });

  it("refuses a scheme, which the storage switch chooses", () => {
    expect(validateTopicName("persistent://public/default/orders", t)).toBe(
      "board.topics.pulsar.nameScheme",
    );
  });

  it("refuses a leading or trailing slash", () => {
    expect(validateTopicName("/orders", t)).toBe("board.topics.pulsar.nameSlash");
    expect(validateTopicName("orders/", t)).toBe("board.topics.pulsar.nameSlash");
  });

  it("refuses a name that would shadow a partition", () => {
    expect(validateTopicName("orders-partition-0", t)).toBe(
      "board.topics.pulsar.namePartitionSuffix",
    );
    expect(validateTopicName("orders-partition-12", t)).toBe(
      "board.topics.pulsar.namePartitionSuffix",
    );
  });

  it("accepts the shapes Pulsar allows", () => {
    for (const name of ["orders", "order-created", "order_created", "orders.v2", "v2/orders"]) {
      expect(validateTopicName(name, t)).toBeNull();
    }
  });
});

/*
 * A blank partition count is zero, which is a real choice.
 *
 * Non-partitioned is the shape most topics want and the one Pulsar creates
 * when asked for none, so a blank field is not a missing value to complain
 * about.
 */
describe("the partition count a create sends", () => {
  it("reads a blank field as a non-partitioned topic", () => {
    expect(parsePartitions("")).toEqual({ value: 0 });
    expect(parsePartitions("  ")).toEqual({ value: 0 });
  });

  it("accepts a whole number", () => {
    expect(parsePartitions("3")).toEqual({ value: 3 });
    expect(parsePartitions("0")).toEqual({ value: 0 });
  });

  // parseInt stops at the first character it cannot read, so "3 partitions"
  // would become 3 and submit a count the user never typed.
  it("refuses anything parseInt would silently truncate", () => {
    expect(parsePartitions("-1")).toEqual({ error: "invalid" });
    expect(parsePartitions("3 partitions")).toEqual({ error: "invalid" });
    expect(parsePartitions("3.5")).toEqual({ error: "invalid" });
    expect(parsePartitions("many")).toEqual({ error: "invalid" });
  });
});
