import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import {
  bytes,
  clusterName,
  duplicateWindow,
  firstTime,
  maxAge,
  maxBytes,
  maxMessages,
  messages,
  mirrorOf,
  replicaLines,
  replicas,
  replicasHealthy,
  retention,
  sealed,
  subjects,
} from "./destinations";

/**
 * The readers separate "the server said zero" from "the server said nothing",
 * and every test here is about one of those pairs. A board that renders them
 * the same tells the reader something untrue about their cluster - a stream
 * with no age limit and one that expires messages instantly are opposite
 * settings, and both arrive here as an absent field and a "0s".
 */
function stream(attributes: Record<string, string>, overrides: Partial<Destination> = {}) {
  return {
    id: 1,
    ref: { namespace: "", name: "ORDERS" },
    partitions: -1,
    subscribers: 0,
    depth: 0,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes,
    ...overrides,
  } as unknown as Destination;
}

describe("what a NATS stream reports", () => {
  it("reads the subject list however it was spaced", () => {
    expect(subjects(stream({ subjects: "orders.created, orders.shipped" }))).toEqual([
      "orders.created",
      "orders.shipped",
    ]);
  });

  /*
   * A mirror takes its messages from another stream rather than from the
   * subject space, so an empty list is a fact about the stream. The board says
   * which stream it mirrors instead of drawing a dash.
   */
  it("reports no subjects on a mirror without pretending the field is missing", () => {
    const mirror = stream({ mirrorOf: "ORDERS" });
    expect(subjects(mirror)).toEqual([]);
    expect(mirrorOf(mirror)).toBe("ORDERS");
  });

  it("takes the message count and size from where each is reported", () => {
    expect(messages(stream({ bytes: "4096" }, { depth: 120 }))).toBe(120);
    expect(bytes(stream({ bytes: "4096" }))).toBe(4096);
  });

  /*
   * -1 is the server's own spelling of "no limit". Returning it as a number
   * would put a negative figure on screen; returning zero would say the stream
   * can hold nothing.
   */
  it("turns the server's -1 limits into no limit at all", () => {
    const unlimited = stream({ maxMsgs: "-1", maxBytes: "-1" });
    expect(maxMessages(unlimited)).toBeNull();
    expect(maxBytes(unlimited)).toBeNull();

    const capped = stream({ maxMsgs: "1000", maxBytes: "1048576" });
    expect(maxMessages(capped)).toBe(1000);
    expect(maxBytes(capped)).toBe(1048576);
  });

  /*
   * Zero is how the server spells "no limit" for a duration, which is the
   * opposite of what a reader would take "0s" to mean.
   */
  it("reads a zero duration as no limit rather than as no time", () => {
    expect(maxAge(stream({ maxAge: "0s" }))).toBeNull();
    expect(maxAge(stream({ maxAge: "24h0m0s" }))).toBe("24h0m0s");
    expect(duplicateWindow(stream({ duplicateWindow: "2m0s" }))).toBe("2m0s");
  });

  it("reports no first message time on a stream that holds nothing", () => {
    expect(firstTime(stream({}))).toBeNull();
    expect(firstTime(stream({ firstTime: "2026-09-02 10:00:00" }))).toBe("2026-09-02 10:00:00");
  });

  it("passes the retention policy through as the server named it", () => {
    expect(retention(stream({ retention: "workqueue" }))).toBe("workqueue");
    expect(retention(stream({}))).toBeNull();
  });

  it("reads the flags that change what may be done to the stream", () => {
    expect(sealed(stream({ sealed: "true" }))).toBe(true);
    expect(sealed(stream({ sealed: "false" }))).toBe(false);
    expect(sealed(stream({}))).toBe(false);
  });
});

/*
 * Three states, not two. A stream on one server is not a healthy stream and
 * not an unhealthy one - it is an unprotected one, and an operator looking at
 * "1 of 1 current" would read it as the first.
 */
describe("whether a stream's copies are keeping up", () => {
  it("reports nothing at all for a stream on a single server", () => {
    const single = stream({ replicas: "1" });
    expect(clusterName(single)).toBeNull();
    expect(replicasHealthy(single)).toBeNull();
    expect(replicaLines(single)).toEqual([]);
  });

  it("reports healthy when every peer is current", () => {
    const healthy = stream({
      clusterName: "mqstudio",
      leader: "nats-2",
      replicas: "3",
      replicasHealthy: "3",
      replicaState: "nats-2 leader\nnats-1 current\nnats-3 current",
    });
    expect(replicas(healthy)).toBe(3);
    expect(replicasHealthy(healthy)).toBe(true);
    expect(replicaLines(healthy)).toHaveLength(3);
  });

  it("reports unhealthy when a peer has fallen behind", () => {
    const behind = stream({
      clusterName: "mqstudio",
      leader: "nats-2",
      replicas: "3",
      replicasHealthy: "2",
      replicaState: "nats-2 leader\nnats-1 current\nnats-3 behind by 41",
    });
    expect(replicasHealthy(behind)).toBe(false);
    expect(replicaLines(behind)).toContain("nats-3 behind by 41");
  });

  /*
   * A replicated stream whose peers the server did not report is not a healthy
   * one. Falling back to "true" would draw a green badge over a fact nobody
   * has.
   */
  it("reports nothing when the peer count is missing", () => {
    expect(replicasHealthy(stream({ clusterName: "mqstudio", replicas: "3" }))).toBeNull();
  });
});
