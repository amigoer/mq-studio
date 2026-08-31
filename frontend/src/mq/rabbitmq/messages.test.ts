import { describe, expect, it } from "vitest";
import type { MessageItem } from "@bindings/model/models";
import {
  amqpProperties,
  deathCount,
  deathQueue,
  deathReason,
  exchange,
  headers,
  persistent,
  redelivered,
  routingKey,
} from "./messages";

const message = (properties: Record<string, string>): MessageItem =>
  ({ id: 1, topic: "q", body: "", properties }) as unknown as MessageItem;

describe("RabbitMQ message readers", () => {
  it("reads the AMQP fields the canonical model has no place for", () => {
    const item = message({ exchange: "ex.order", routingKey: "order.created" });
    expect(exchange(item)).toBe("ex.order");
    expect(routingKey(item)).toBe("order.created");
  });

  /*
   * A transient message on a durable queue is still lost when the node goes
   * down. People are surprised by that often enough for it to be worth its own
   * reading rather than being buried in the property list.
   */
  it("tells persistent from transient", () => {
    expect(persistent(message({ deliveryMode: "persistent" }))).toBe(true);
    expect(persistent(message({ deliveryMode: "transient" }))).toBe(false);
    expect(persistent(message({}))).toBe(false);
  });

  it("reads the redelivered flag", () => {
    expect(redelivered(message({ redelivered: "true" }))).toBe(true);
    expect(redelivered(message({ redelivered: "false" }))).toBe(false);
  });

  /*
   * The driver namespaces application headers so they cannot collide with the
   * AMQP properties beside them - a message may legitimately carry a header
   * called "priority".
   */
  it("separates application headers from AMQP properties", () => {
    const item = message({
      "header.retries": "3",
      "header.priority": "urgent",
      priority: "5",
      exchange: "ex.order",
    });
    expect(headers(item)).toEqual({ retries: "3", priority: "urgent" });
    expect(amqpProperties(item)).toEqual({ priority: "5", exchange: "ex.order" });
  });

  /*
   * x-death is how a dead-lettered message carries its history, and reading it
   * is what turns "this is in the dead-letter queue" into "this failed four
   * times on order.settle.q because the consumer rejected it".
   */
  it("reads the death history out of x-death", () => {
    const item = message({
      "header.x-death": "[{count=4, queue=order.settle.q, reason=rejected, exchange=ex.order}]",
    });
    expect(deathCount(item)).toBe(4);
    expect(deathQueue(item)).toBe("order.settle.q");
    expect(deathReason(item)).toBe("rejected");
  });

  /*
   * Null rather than zero for a message that has never been dead-lettered.
   * Zero would claim it died zero times, which is a different statement from
   * "there is no death history here".
   */
  it("has no death count for a message that carries no history", () => {
    expect(deathCount(message({}))).toBeNull();
    expect(deathCount(message({ "header.x-death": "unparseable" }))).toBeNull();
    expect(deathQueue(message({}))).toBe("");
    expect(deathReason(message({}))).toBe("");
  });
});
