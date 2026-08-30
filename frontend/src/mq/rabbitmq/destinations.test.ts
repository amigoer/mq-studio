import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import {
  argumentsOf,
  consumerUtilisation,
  featureTags,
  leader,
  members,
  messagesReady,
  messagesUnacknowledged,
  onlineMembers,
  policy,
  queueType,
} from "./destinations";

const queue = (attributes: Record<string, string>): Destination =>
  ({ ref: { namespace: "/", name: "q" }, attributes }) as unknown as Destination;

describe("RabbitMQ queue readers", () => {
  /*
   * The broker omits the type when it is the default, so an absent one is
   * classic rather than unknown. Rendering it blank would make half a normal
   * cluster's rows look broken.
   */
  it("reads an absent queue type as classic", () => {
    expect(queueType(queue({}))).toBe("classic");
    expect(queueType(queue({ queueType: "quorum" }))).toBe("quorum");
  });

  it("splits ready from unacknowledged", () => {
    const q = queue({ messagesReady: "982", messagesUnacknowledged: "14" });
    expect(messagesReady(q)).toBe(982);
    expect(messagesUnacknowledged(q)).toBe(14);
  });

  /*
   * Arguments cross as JSON because the types carry meaning: a reader has to
   * be able to tell the number 5000 from the string "5000", and a header
   * argument can be a nested table.
   */
  it("decodes the declared arguments with their types intact", () => {
    const args = argumentsOf(
      queue({
        arguments: JSON.stringify({
          "x-message-ttl": 30000,
          "x-overflow": "reject-publish",
          "x-single-active-consumer": true,
          "x-custom": { nested: 1 },
        }),
      }),
    );
    expect(args["x-message-ttl"]).toBe(30000);
    expect(args["x-overflow"]).toBe("reject-publish");
    expect(args["x-single-active-consumer"]).toBe(true);
    expect(args["x-custom"]).toEqual({ nested: 1 });
  });

  it("treats an absent or unparsable argument blob as no arguments", () => {
    expect(argumentsOf(queue({}))).toEqual({});
    expect(argumentsOf(queue({ arguments: "not json" }))).toEqual({});
  });

  /*
   * The tags are what a reader scans a row for, and each has to come from
   * something the queue was actually declared with rather than from a guess.
   */
  it("tags a queue from what it was declared with", () => {
    const tagged = queue({
      durable: "true",
      arguments: JSON.stringify({
        "x-dead-letter-exchange": "dlx",
        "x-message-ttl": 30000,
        "x-max-length": 5000,
      }),
    });
    expect(featureTags(tagged)).toEqual(["DLX", "TTL", "max-length"]);
  });

  it("tags what makes a queue unusual rather than what makes it normal", () => {
    // A durable, non-exclusive queue with no arguments is the ordinary case
    // and earns no tags at all.
    expect(featureTags(queue({ durable: "true" }))).toEqual([]);
    expect(featureTags(queue({ durable: "false" }))).toEqual(["transient"]);
    expect(featureTags(queue({ durable: "true", exclusive: "true" }))).toEqual(["exclusive"]);
  });

  // The type has its own column; repeating it as a tag spends the row's width
  // saying the same thing twice.
  it("does not tag the queue type", () => {
    const q = queue({ durable: "true", arguments: JSON.stringify({ "x-queue-type": "quorum" }) });
    expect(featureTags(q)).toEqual([]);
  });

  /*
   * Replication is a quorum and stream concept. A classic queue reports none
   * of it, and an empty member list would read as "replicated nowhere" rather
   * than as "not a replicated queue".
   */
  it("reads replication only where the queue has it", () => {
    const classic = queue({ queueType: "classic" });
    expect(members(classic)).toEqual([]);
    expect(leader(classic)).toBe("");

    const quorum = queue({
      queueType: "quorum",
      leader: "rabbit@one",
      members: "rabbit@one,rabbit@two,rabbit@three",
      onlineMembers: "rabbit@one,rabbit@two",
    });
    expect(leader(quorum)).toBe("rabbit@one");
    expect(members(quorum)).toHaveLength(3);
    // The third is a member that is down, which is the whole point of showing
    // both lists rather than one count.
    expect(onlineMembers(quorum)).toEqual(["rabbit@one", "rabbit@two"]);
  });

  /*
   * The broker reports zero utilisation for a queue nobody is consuming, which
   * reads as "the consumers are idle". The driver omits the attribute instead,
   * and null is what the panel reads as "there is nothing to report".
   */
  it("has no utilisation figure without a consumer", () => {
    expect(consumerUtilisation(queue({}))).toBeNull();
    expect(consumerUtilisation(queue({ consumerUtilisation: "0.85" }))).toBeCloseTo(0.85);
  });

  it("reads the matched policy, or nothing when none matched", () => {
    expect(policy(queue({ policy: "ha-all" }))).toBe("ha-all");
    expect(policy(queue({}))).toBe("");
  });
});
