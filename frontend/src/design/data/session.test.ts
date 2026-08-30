import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSession, restoreSession, writeSession, type ShellSession } from "./session";

const KEY = "mq-studio:shell-session";

describe("shell session storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
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
  });

  it("returns nothing when the window has no stored session", () => {
    expect(readSession()).toEqual({});
  });

  it("round-trips a written session", () => {
    writeSession({
      openTabs: ["1", "2"],
      activeTab: "2",
      pageByTab: { "1": "topics", "2": "consumers" },
      navCollapsed: true,
    });
    expect(readSession()).toEqual({
      openTabs: ["1", "2"],
      activeTab: "2",
      pageByTab: { "1": "topics", "2": "consumers" },
      navCollapsed: true,
    });
  });

  it("keeps tabs whose profile it cannot see: pruning is the shell's job", () => {
    writeSession({
      openTabs: ["7"],
      activeTab: "7",
      pageByTab: { "7": "dlq" },
      navCollapsed: false,
    });
    expect(readSession().openTabs).toEqual(["7"]);
  });

  it("reads nothing out of junk", () => {
    store.set(KEY, "{not json");
    expect(readSession()).toEqual({});
  });

  it("drops fields that are not the shape they claim", () => {
    store.set(
      KEY,
      JSON.stringify({ openTabs: [1, "2", null], activeTab: 5, pageByTab: 7, navCollapsed: "yes" }),
    );
    expect(readSession()).toEqual({ openTabs: ["2"] });
  });
});

describe("restoreSession", () => {
  const stored: Partial<ShellSession> = {
    openTabs: ["1", "2", "3"],
    activeTab: "2",
    pageByTab: { "1": "topics", "2": "consumers", "3": "dlq" },
    navCollapsed: false,
  };

  it("reopens the tabs whose profile is still there, in order", () => {
    const opening = restoreSession(stored, ["3", "1"]);
    expect(opening.openTabs).toEqual(["1", "3"]);
    expect(opening.pageByTab).toEqual({ "1": "topics", "3": "dlq" });
  });

  it("keeps the tab that was in front", () => {
    expect(restoreSession(stored, ["1", "2", "3"]).activeTab).toBe("2");
  });

  it("falls back to the first survivor when the front tab's profile is gone", () => {
    expect(restoreSession(stored, ["1", "3"]).activeTab).toBe("1");
  });

  it("restores nothing when no profile survived", () => {
    expect(restoreSession(stored, [])).toEqual({
      openTabs: [],
      activeTab: null,
      pageByTab: {},
    });
  });

  it("restores nothing from an empty session", () => {
    expect(restoreSession({}, ["1"])).toEqual({
      openTabs: [],
      activeTab: null,
      pageByTab: {},
    });
  });
});
