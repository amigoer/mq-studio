import { describe, expect, it } from "vitest";
import { DeadLetterQueue, DeadLetterSource } from "@bindings/model/models";
import {
  DeadLetterKind,
  isOrphaned,
  kindOf,
  reported,
  sourceSubscription,
  sourceTopic,
} from "./deadletter";

const queue = (name: string, sources: { queue: string; subscription: string }[] = []) =>
  new DeadLetterQueue({
    name,
    depth: 0,
    consumers: 0,
    sources: sources.map((source) => new DeadLetterSource(source)),
  });

/*
 * A retry topic is a pipeline; a DLQ is where it ends up.
 *
 * A growing retry topic means consumers are failing and recovering, and a
 * growing DLQ means they have given up - the same number means two different
 * things depending on which it is.
 */
describe("which half of the convention a topic follows", () => {
  it("reads it off the suffix", () => {
    expect(kindOf(queue("orders-worker-DLQ"))).toBe(DeadLetterKind.Dlq);
    expect(kindOf(queue("orders-worker-RETRY"))).toBe(DeadLetterKind.Retry);
  });
});

/*
 * The subscription is the answer this page exists for.
 *
 * One topic read by five subscriptions has five separate dead-letter topics,
 * and naming only the topic would not say which reader is failing.
 */
describe("where a dead-letter topic came from", () => {
  it("names both the topic and the subscription", () => {
    const row = queue("orders-worker-DLQ", [{ queue: "orders", subscription: "worker" }]);
    expect(sourceTopic(row)).toBe("orders");
    expect(sourceSubscription(row)).toBe("worker");
    expect(isOrphaned(row)).toBe(false);
  });

  /*
   * An orphan holds a backlog nothing will ever drain and nobody will ever
   * look at, which is the single most useful row on the page - so it has to
   * read as a finding rather than as blank columns.
   */
  it("marks one whose origin is gone", () => {
    const row = queue("gone-reader-DLQ");
    expect(isOrphaned(row)).toBe(true);
    expect(sourceTopic(row)).toBe("");
    expect(sourceSubscription(row)).toBe("");
  });
});

// A depth the driver could not read is absent, not zero: a dead-letter topic
// shown as empty is one nobody investigates.
describe("a figure the driver did not report", () => {
  it("reads as null rather than zero", () => {
    expect(reported(-1)).toBeNull();
    expect(reported(0)).toBe(0);
    expect(reported(12)).toBe(12);
  });
});
