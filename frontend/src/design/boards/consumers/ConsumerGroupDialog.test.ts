import { describe, expect, it } from "vitest";
import { Subscription, SubscriptionRef } from "@bindings/model/models";
import { ConsumeMode } from "@/mq/rocketmq/subscriptions";
import { clampRetries, formOf, validate } from "./ConsumerGroupDialog";

const t = (key: string) => key;

const group = (attributes: Record<string, string>): Subscription =>
  new Subscription({
    ref: new SubscriptionRef({ name: "ORDER_CONSUMER", namespace: "" }),
    attributes,
  });

/**
 * RocketMQ has no partial update: CreateSubscriptionGroup carries a whole
 * SubscriptionGroupConfig and the broker stores exactly what it is handed. So
 * every field the form opens with is a field it will write back, and a wrong
 * default here changes a setting nobody touched.
 */
describe("the consumer group form a group opens with", () => {
  it("carries the stored broadcast permission back rather than a default", () => {
    const form = formOf(group({ broadcastEnabled: "true", maxRetry: "16" }));
    expect(form.consumeMode).toBe(ConsumeMode.Broadcasting);
  });

  /*
   * consumeMode on a Subscription is what a connected client reports and is
   * empty while none is attached. Reading it as the permission would turn
   * "nobody is consuming right now" into "broadcasting is off" and write that.
   */
  it("does not read the permission off the client-reported mode", () => {
    const broadcasting = group({
      broadcastEnabled: "true",
      consumeMode: "",
      maxRetry: "16",
    });
    expect(formOf(broadcasting).consumeMode).toBe(ConsumeMode.Broadcasting);

    const clustering = group({
      broadcastEnabled: "false",
      consumeMode: ConsumeMode.Broadcasting,
      maxRetry: "16",
    });
    expect(formOf(clustering).consumeMode).toBe(ConsumeMode.Clustering);
  });

  it("keeps the group's own retry count", () => {
    expect(formOf(group({ maxRetry: "3" })).maxRetry).toBe(3);
  });

  /*
   * A group whose config could not be read reports 0, which is not a retry
   * count anyone chose. Writing it back would turn retries off, so the
   * broker's own default stands in.
   */
  it("falls back to RocketMQ's default when the broker reported no retry count", () => {
    expect(formOf(group({ maxRetry: "0" })).maxRetry).toBe(16);
  });

  it("opens a create blank, on every master, clustering", () => {
    expect(formOf(undefined)).toEqual({
      group: "",
      brokerAddr: "",
      consumeMode: ConsumeMode.Clustering,
      maxRetry: 16,
    });
  });
});

describe("what the form refuses to save", () => {
  const form = (group: string) => ({ ...formOf(undefined), group });

  it("needs a name", () => {
    expect(validate(form(""), t)).toBe("board.consumers.rocketmq.form.nameRequired");
    expect(validate(form("   "), t)).toBe("board.consumers.rocketmq.form.nameRequired");
  });

  // The name reaches the broker inside %RETRY%<group>, so neither survives.
  it("refuses a space or a percent in the name", () => {
    expect(validate(form("ORDER CONSUMER"), t)).toBe(
      "board.consumers.rocketmq.form.nameInvalid",
    );
    expect(validate(form("%RETRY%X"), t)).toBe("board.consumers.rocketmq.form.nameInvalid");
  });

  it("accepts an ordinary name", () => {
    expect(validate(form("ORDER_CONSUMER"), t)).toBeNull();
  });
});

describe("the retry count", () => {
  it("never goes negative, however the field is typed into", () => {
    expect(clampRetries(-1)).toBe(0);
  });

  it("stops at a thousand", () => {
    expect(clampRetries(5000)).toBe(1000);
  });
});
