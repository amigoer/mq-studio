import { describe, expect, it } from "vitest";
import { MessageItem } from "@bindings/model/models";
import {
  eventTime,
  orderingKey,
  parsePropertyFilter,
  producerName,
  producerProperties,
  redeliveryCount,
} from "./messages";

const t = (key: string) => key;

const message = (properties: Record<string, string> = {}): MessageItem =>
  new MessageItem({ properties });

/*
 * The driver's own properties are separated from the producer's.
 *
 * The driver puts the batch index, the producer name and the event time into
 * the same map the application's properties live in, because MessageItem has
 * nowhere else for them. A panel that showed them together would present
 * "pulsar.batchIndex" as something the application set.
 */
describe("a message's properties", () => {
  it("shows only what the producer set", () => {
    const item = message({
      "pulsar.batchIndex": "0",
      "pulsar.producer": "orders-api",
      stage: "paid",
      region: "eu",
    });

    expect(producerProperties(item)).toEqual([
      ["region", "eu"],
      ["stage", "paid"],
    ]);
  });

  it("reads the driver's own through named accessors", () => {
    const item = message({
      "pulsar.producer": "orders-api",
      "pulsar.orderingKey": "customer-7",
      "pulsar.eventTime": "2026-09-02 10:30:00",
    });

    expect(producerName(item)).toBe("orders-api");
    expect(orderingKey(item)).toBe("customer-7");
    expect(eventTime(item)).toBe("2026-09-02 10:30:00");
  });

  it("sorts them so the panel does not reshuffle between reads", () => {
    const item = message({ zulu: "1", alpha: "2", mike: "3" });
    expect(producerProperties(item).map(([key]) => key)).toEqual(["alpha", "mike", "zulu"]);
  });
});

/*
 * A message going round repeatedly is one about to be dead-lettered, which is
 * the most useful thing on a browse of a topic somebody is debugging. The
 * driver only writes the property when it is non-zero, so an absent one is
 * genuinely zero rather than unknown.
 */
describe("the redelivery count", () => {
  it("is zero when the driver did not write it", () => {
    expect(redeliveryCount(message())).toBe(0);
  });

  it("reads what the driver wrote", () => {
    expect(redeliveryCount(message({ "pulsar.redeliveryCount": "4" }))).toBe(4);
  });

  it("does not throw on something unreadable", () => {
    expect(redeliveryCount(message({ "pulsar.redeliveryCount": "many" }))).toBe(0);
  });
});

/*
 * The property filter replaces the tag every other family narrows by, so its
 * two forms both have to work: a bare name asks which messages carry it at
 * all, and name=value matches one.
 */
describe("the property filter", () => {
  it("is absent when the field is blank", () => {
    expect(parsePropertyFilter("", t)).toBeNull();
    expect(parsePropertyFilter("   ", t)).toBeNull();
  });

  it("passes a bare name through, which asks about presence", () => {
    expect(parsePropertyFilter("stage", t)).toEqual({ filter: "stage" });
  });

  it("passes name=value through", () => {
    expect(parsePropertyFilter("stage=paid", t)).toEqual({ filter: "stage=paid" });
  });

  // "=paid" would reach the driver as a filter on a property with no name,
  // which matches nothing and looks like a broken search rather than a typo.
  it("refuses a value with no name", () => {
    expect(parsePropertyFilter("=paid", t)).toEqual({
      error: "board.messages.pulsar.propertyNameRequired",
    });
  });
});
