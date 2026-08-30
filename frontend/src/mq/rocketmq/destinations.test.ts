import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import { TopicKind, routes, subscribers, topicKind } from "./destinations";

function topic(name: string, attributes: Record<string, string> = {}): Destination {
  return {
    id: 1,
    ref: { namespace: "", name },
    partitions: 4,
    subscribers: 0,
    depth: -1,
    rateIn: 0,
    rateOut: 0,
    lastUpdated: "",
    attributes,
  } as Destination;
}

describe("topicKind", () => {
  it("reads retry and dead letter off the prefix, either spelling", () => {
    expect(topicKind(topic("%RETRY%CID_ORDER"))).toBe(TopicKind.Retry);
    expect(topicKind(topic("RETRY%CID_ORDER"))).toBe(TopicKind.Retry);
    expect(topicKind(topic("%DLQ%CID_ORDER"))).toBe(TopicKind.DLQ);
    expect(topicKind(topic("DLQ%CID_ORDER"))).toBe(TopicKind.DLQ);
  });

  it("prefers the prefix over the message type", () => {
    expect(topicKind(topic("%DLQ%CID", { messageType: "FIFO" }))).toBe(TopicKind.DLQ);
  });

  it("falls back to the broker's message type", () => {
    expect(topicKind(topic("ORDER", { messageType: "FIFO" }))).toBe(TopicKind.FIFO);
    expect(topicKind(topic("ORDER", { messageType: "Delay" }))).toBe(TopicKind.Delay);
    expect(topicKind(topic("ORDER"))).toBe(TopicKind.Normal);
  });

  it("does not mistake a name that merely contains the prefix", () => {
    expect(topicKind(topic("ORDER_RETRY%QUEUE"))).toBe(TopicKind.Normal);
  });
});

describe("routes and subscribers", () => {
  it("decodes what the driver encoded", () => {
    const encoded = topic("ORDER", {
      routes: JSON.stringify([
        { broker: "broker-a", brokerAddr: "1.2.3.4:10911", readQueue: 4, writeQueue: 4, perm: "RW" },
      ]),
      subscribers: JSON.stringify(["CID_A", "CID_B"]),
    });
    expect(routes(encoded)).toHaveLength(1);
    expect(routes(encoded)[0]?.broker).toBe("broker-a");
    expect(subscribers(encoded)).toEqual(["CID_A", "CID_B"]);
  });

  it("reads an absent or unparseable field as empty rather than throwing", () => {
    expect(routes(topic("ORDER"))).toEqual([]);
    expect(subscribers(topic("ORDER"))).toEqual([]);
    expect(routes(topic("ORDER", { routes: "{" }))).toEqual([]);
    expect(subscribers(topic("ORDER", { subscribers: "{" }))).toEqual([]);
  });
});
