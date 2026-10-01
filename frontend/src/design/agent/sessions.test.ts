import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import type { AgentItem, AgentSummary } from "@/api/agent";
import type { Conversation } from "./conversation";
import { dayFrom, sectionsOf } from "./sessions";

const now = new Date(2026, 9, 1, 14, 0);
const at = (days: number, hours = 0) => new Date(2026, 9, 1 - days, 9 + hours).toISOString();

const summary = (id: string, title: string, updated: string, connection?: string): AgentSummary =>
  ({
    id,
    title,
    provider: "p1",
    model: "qwen3",
    connection: connection == null ? null : { id: 1, name: connection, family: "rabbitmq" },
    created: updated,
    updated,
    running: false,
    open: false,
  }) as AgentSummary;

describe("dayFrom", () => {
  it("heads a conversation by the calendar day it last changed", () => {
    expect(dayFrom(at(0), now)).toBe("today");
    expect(dayFrom(new Date(2026, 9, 1, 0, 1).toISOString(), now)).toBe("today");
    expect(dayFrom(new Date(2026, 8, 30, 23, 59).toISOString(), now)).toBe("yesterday");
    expect(dayFrom(at(5), now)).toBe("earlier");
  });
});

describe("sectionsOf", () => {
  const listed = [
    summary("a", "legacy-sync backlog", at(0, 3), "orders"),
    summary("b", "dead letters", at(0)),
    summary("c", "pipeline lag", at(1), "pipeline"),
    summary("d", "old one", at(9), "notify"),
  ];

  it("keeps the newest-first order under each day", () => {
    expect(sectionsOf(listed, "", now).map((section) => [section.day, section.summaries.map((one) => one.id)])).toEqual([
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      ["earlier", ["d"]],
    ]);
  });

  it("finds a conversation by its title or its connection", () => {
    expect(sectionsOf(listed, "  PIPE ", now).flatMap((section) => section.summaries.map((one) => one.id))).toEqual([
      "c",
    ]);
    expect(sectionsOf(listed, "notify", now).flatMap((section) => section.summaries.map((one) => one.id))).toEqual([
      "d",
    ]);
    expect(sectionsOf(listed, "nothing like it", now)).toEqual([]);
  });
});

describe("transcriptOf", () => {
  let transcriptOf: typeof import("./sessions").transcriptOf;
  let t: TFunction;

  beforeAll(async () => {
    const storage = { getItem: () => null, setItem() {}, removeItem() {} };
    vi.stubGlobal("window", { localStorage: storage, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("localStorage", storage);
    const [sessions, i18n] = await Promise.all([import("./sessions"), import("@/i18n")]);
    transcriptOf = sessions.transcriptOf;
    await i18n.default.changeLanguage("en");
    t = i18n.default.t.bind(i18n.default) as TFunction;
  });

  it("writes what was said, what was called and why a run stopped, without the thinking", () => {
    const conversation: Conversation = {
      session: "s1",
      seq: 9,
      title: "",
      running: false,
      model: "qwen3:14b",
      usage: { input: 1, output: 1 },
      items: [
        { id: "1", kind: "user", text: "Why is orders behind?" },
        { id: "2", kind: "thinking", text: "Look at the lag." },
        {
          id: "3",
          kind: "tool",
          tool: { call: "c", name: "subscription_lag", title: "", input: { group: "legacy-sync" }, state: "done" },
        },
        {
          id: "4",
          kind: "tool",
          tool: {
            call: "d",
            name: "destination_purge",
            title: "",
            blast: "destructive",
            input: { name: "orders" },
            state: "declined",
            result: "not done: the person declined it",
          },
        },
        { id: "5", kind: "text", text: "| Group | Lag |\n| --- | ---: |\n| `legacy-sync` | 83,930 |" },
        { id: "6", kind: "notice", notice: "limit", text: "25" },
      ] as AgentItem[],
    };
    const markdown = transcriptOf(conversation, t, "10/1/2026, 2:00 PM");
    expect(markdown).toBe(
      [
        "# Why is orders behind?",
        "",
        "qwen3:14b · 10/1/2026, 2:00 PM",
        "",
        "### You",
        "",
        "Why is orders behind?",
        "",
        "### Assistant",
        "",
        "- Read consume progress `legacy-sync` · Done",
        "- Empty a destination `orders` · Declined · not done: the person declined it",
        "",
        "| Group | Lag |",
        "| --- | ---: |",
        "| `legacy-sync` | 83,930 |",
        "",
        "> Paused after 25 tool calls",
        "",
      ].join("\n"),
    );
  });
});
