import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecentPicks, recordRecentPick } from "./recentPicks";

const KEY = "mq-studio:recent-picks";

describe("recentPicks storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadRecentPicks("c1:localhost:9876", "topic")).toEqual([]);
  });

  it("records a pick and reads it back", () => {
    expect(recordRecentPick("c1", "topic", "TopicA")).toEqual(["TopicA"]);
    expect(loadRecentPicks("c1", "topic")).toEqual(["TopicA"]);
    expect(store.get(KEY)).toBeTruthy();
  });

  it("puts the newest pick first and never duplicates", () => {
    recordRecentPick("c1", "topic", "TopicA");
    recordRecentPick("c1", "topic", "TopicB");
    expect(recordRecentPick("c1", "topic", "TopicA")).toEqual([
      "TopicA",
      "TopicB",
    ]);
  });

  it("ignores an empty value", () => {
    recordRecentPick("c1", "topic", "TopicA");
    expect(recordRecentPick("c1", "topic", "")).toEqual(["TopicA"]);
  });

  it("keeps only the 10 most recent picks", () => {
    for (let i = 1; i <= 12; i++) recordRecentPick("c1", "topic", `Topic${i}`);
    const recent = loadRecentPicks("c1", "topic");
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe("Topic12");
    expect(recent).not.toContain("Topic1");
    expect(recent).not.toContain("Topic2");
  });

  it("keeps topics and groups apart", () => {
    recordRecentPick("c1", "topic", "TopicA");
    recordRecentPick("c1", "group", "GroupA");
    expect(loadRecentPicks("c1", "topic")).toEqual(["TopicA"]);
    expect(loadRecentPicks("c1", "group")).toEqual(["GroupA"]);
  });

  it("does not leak picks across connections", () => {
    recordRecentPick("c1", "topic", "TopicA");
    recordRecentPick("c2", "topic", "TopicB");
    expect(loadRecentPicks("c1", "topic")).toEqual(["TopicA"]);
    expect(loadRecentPicks("c2", "topic")).toEqual(["TopicB"]);
  });

  it("drops the least recently used connections past the scope cap", () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
    for (let i = 1; i <= 12; i++) recordRecentPick(`c${i}`, "topic", "TopicA");
    const file = JSON.parse(store.get(KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(file)).toHaveLength(10);
    expect(file.c1).toBeUndefined();
    expect(file.c2).toBeUndefined();
    expect(file.c12).toBeDefined();
  });

  it("survives a corrupted store", () => {
    store.set(KEY, "{ not json");
    expect(loadRecentPicks("c1", "topic")).toEqual([]);
    expect(recordRecentPick("c1", "topic", "TopicA")).toEqual(["TopicA"]);
  });

  it("discards junk entries when reading", () => {
    store.set(
      KEY,
      JSON.stringify({
        c1: {
          topics: ["TopicA", 42, "", "TopicA", "TopicB"],
          groups: "nope",
          updatedAt: "soon",
        },
      }),
    );
    expect(loadRecentPicks("c1", "topic")).toEqual(["TopicA", "TopicB"]);
    expect(loadRecentPicks("c1", "group")).toEqual([]);
  });
});
