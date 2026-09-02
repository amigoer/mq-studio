import { describe, expect, it } from "vitest";
import type { Destination } from "@bindings/model/models";
import {
  entriesAdded,
  firstEntryId,
  groupCount,
  groupNames,
  lastEntryId,
  lastGeneratedId,
  length,
  maxDeletedEntryId,
  memoryBytes,
  radixTreeKeys,
  streamKey,
  trimmedAway,
} from "./destinations";

function stream(attributes: Record<string, string>, overrides: Partial<Destination> = {}) {
  return {
    id: 1,
    ref: { namespace: "", name: "orders:events" },
    partitions: -1,
    subscribers: 3,
    depth: 1000,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes,
    ...overrides,
  } as unknown as Destination;
}

describe("the Redis stream readers", () => {
  it("reads the key, the length and the group count off the canonical fields", () => {
    const destination = stream({});
    expect(streamKey(destination)).toBe("orders:events");
    expect(length(destination)).toBe(1000);
    expect(groupCount(destination)).toBe(3);
  });

  it("reads the ids and counters out of the attribute map", () => {
    const destination = stream({
      lastGeneratedId: "1756454646018-0",
      firstEntryId: "1756368200104-0",
      lastEntryId: "1756454646018-0",
      maxDeletedEntryId: "1756454640000-2",
      entriesAdded: "1300000",
      radixTreeKeys: "11842",
      memoryBytes: "90177536",
    });
    expect(lastGeneratedId(destination)).toBe("1756454646018-0");
    expect(firstEntryId(destination)).toBe("1756368200104-0");
    expect(lastEntryId(destination)).toBe("1756454646018-0");
    expect(maxDeletedEntryId(destination)).toBe("1756454640000-2");
    expect(entriesAdded(destination)).toBe(1300000);
    expect(radixTreeKeys(destination)).toBe(11842);
    expect(memoryBytes(destination)).toBe(90177536);
  });

  /*
   * The distinction the whole module exists for. An empty stream has no first
   * entry and a server that would not answer MEMORY USAGE gives no figure -
   * both are "not reported", and returning 0 would put a number on the page
   * that the broker never said.
   */
  it("reads an absent figure as null rather than zero", () => {
    const destination = stream({});
    expect(firstEntryId(destination)).toBeNull();
    expect(lastEntryId(destination)).toBeNull();
    expect(maxDeletedEntryId(destination)).toBeNull();
    expect(entriesAdded(destination)).toBeNull();
    expect(memoryBytes(destination)).toBeNull();
    expect(radixTreeKeys(destination)).toBeNull();
  });

  it("reads an empty attribute as absent too", () => {
    const destination = stream({ firstEntryId: "", memoryBytes: "" });
    expect(firstEntryId(destination)).toBeNull();
    expect(memoryBytes(destination)).toBeNull();
  });

  it("splits the group names, and has none when the detail was not read", () => {
    expect(groupNames(stream({ groupNames: "settle-group,notify-group" }))).toEqual([
      "settle-group",
      "notify-group",
    ]);
    expect(groupNames(stream({ groupNames: "" }))).toEqual([]);
    expect(groupNames(stream({}))).toEqual([]);
  });

  /*
   * entries-added counts everything the stream has ever held and XLEN counts
   * what is left, so the difference is what trimming took away. It is the one
   * figure that says whether a stream is bounded, which is what the canvas's
   * invented maxlen column was reaching for.
   */
  it("derives how much has been trimmed away", () => {
    expect(trimmedAway(stream({ entriesAdded: "1300000" }, { depth: 1000000 }))).toBe(300000);
    // A stream nothing has been trimmed from.
    expect(trimmedAway(stream({ entriesAdded: "1000" }, { depth: 1000 }))).toBe(0);
    // entries-added is Redis 7.0 and later. Without it the difference is
    // unknown, not zero - an older server must not be shown as untrimmed.
    expect(trimmedAway(stream({}))).toBeNull();
  });

  // A counter that ran while entries were being deleted can report fewer added
  // than are held. Reporting a negative trim would be arithmetic on screen.
  it("never reports a negative trim", () => {
    expect(trimmedAway(stream({ entriesAdded: "10" }, { depth: 50 }))).toBe(0);
  });
});
