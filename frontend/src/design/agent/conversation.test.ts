import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentItem } from "@/api/agent";
import {
  applyEvent,
  blocksOf,
  compactCount,
  fromSnapshot,
  opened,
  targetOf,
  titleOf,
  tokensOf,
  waitingAsk,
  type Conversation,
} from "./conversation";

const event = (seq: number, fields: Partial<AgentEvent>): AgentEvent =>
  ({ session: "s1", seq, kind: "run", running: false, ...fields }) as AgentEvent;

const tool = (id: string, name: string, blast: string, state = "done"): AgentItem =>
  ({ id, kind: "tool", tool: { call: id, name, title: name, blast, input: {}, state } }) as AgentItem;

function play(state: Conversation, events: AgentEvent[]): Conversation | "gap" {
  let current: Conversation | "gap" = state;
  for (const one of events) {
    if (current === "gap") return current;
    current = applyEvent(current, one);
  }
  return current;
}

describe("applyEvent", () => {
  it("builds a conversation from its events in order", () => {
    const state = play(opened("s1", "qwen3"), [
      event(1, { kind: "item", item: { id: "1", kind: "user", text: "hi" } as AgentItem }),
      event(2, { kind: "run", running: true }),
      event(3, { kind: "item", item: { id: "2", kind: "text", text: "Hel" } as AgentItem }),
      event(4, { kind: "delta", itemId: "2", text: "lo." }),
      event(5, { kind: "run", running: false, model: "qwen3:14b", usage: { input: 5, output: 2 } }),
    ]);
    expect(state).not.toBe("gap");
    const conversation = state as Conversation;
    expect(conversation.items.map((item) => item.text)).toEqual(["hi", "Hello."]);
    expect(conversation).toMatchObject({ seq: 5, running: false, model: "qwen3:14b" });
    expect(tokensOf(conversation.usage)).toBe(7);
  });

  it("replaces an item it already holds rather than adding it twice", () => {
    const first = tool("1", "destination_create", "mutate", "waiting");
    const decided = tool("1", "destination_create", "mutate", "done");
    const state = play(opened("s1", "m"), [
      event(1, { kind: "item", item: first }),
      event(2, { kind: "item", item: decided }),
    ]) as Conversation;
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.tool?.state).toBe("done");
  });

  it("skips what a snapshot already holds, and asks for one when an event is missing", () => {
    const snapshot = fromSnapshot({
      session: "s1",
      seq: 4,
      title: "",
      running: true,
      model: "m",
      items: [{ id: "1", kind: "text", text: "Hel" } as AgentItem],
      usage: { input: 0, output: 0 },
    });
    expect(applyEvent(snapshot, event(3, { kind: "delta", itemId: "1", text: "x" }))).toBe(snapshot);
    expect(applyEvent(snapshot, event(6, { kind: "delta", itemId: "1", text: "x" }))).toBe("gap");
    // A delta for an item it never saw is a gap too, whatever its number says.
    expect(applyEvent(snapshot, event(5, { kind: "delta", itemId: "9", text: "x" }))).toBe("gap");
  });

  it("takes the title a conversation is renamed to, and falls back to its first question", () => {
    const asked = play(opened("s1", "m"), [
      event(1, { kind: "item", item: { id: "1", kind: "user", text: "Why is orders behind?\nIt was fine." } as AgentItem }),
    ]) as Conversation;
    expect(titleOf(asked)).toBe("Why is orders behind?");
    const renamed = applyEvent(asked, event(2, { kind: "title", text: "orders backlog" })) as Conversation;
    expect(renamed.title).toBe("orders backlog");
    expect(titleOf(renamed)).toBe("orders backlog");
  });

  it("ignores another conversation's events", () => {
    const state = opened("s1", "m");
    expect(applyEvent(state, { ...event(1, { kind: "run", running: true }), session: "s2" })).toBe(state);
  });
});

describe("blocksOf", () => {
  it("folds reads in a row and keeps every write on its own", () => {
    const blocks = blocksOf([
      { id: "1", kind: "user", text: "q" } as AgentItem,
      tool("2", "subscription_lag", "read"),
      tool("3", "subscription_consumers", "read"),
      tool("4", "subscription_reset_offset", "mutate", "waiting"),
      tool("5", "destinations_list", "read"),
      { id: "6", kind: "text", text: "a" } as AgentItem,
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(["user", "reads", "write", "reads", "text"]);
    const reads = blocks[1];
    expect(reads?.kind === "reads" ? reads.items.map((item) => item.id) : []).toEqual(["2", "3"]);
  });

  it("finds the question waiting on the person", () => {
    const waiting = { ...tool("2", "destination_purge", "destructive", "waiting") };
    waiting.tool = { ...waiting.tool!, ask: { id: "2", kind: "confirm", question: "Empty orders?" } };
    expect(waitingAsk([tool("1", "destinations_list", "read"), waiting])?.id).toBe("2");
    expect(waitingAsk([tool("1", "destinations_list", "read")])).toBeUndefined();
  });
});

describe("targetOf", () => {
  it("names the group before the topic a call about the group also carries", () => {
    const item = tool("1", "subscription_lag", "read");
    item.tool!.input = { connection: 1, destination: "order-create", group: "legacy-sync" };
    expect(targetOf(item.tool!)).toBe("legacy-sync");
    item.tool!.input = { connection: 1 };
    expect(targetOf(item.tool!)).toBeUndefined();
    item.tool!.input = "{\"connection\": 1, \"na";
    expect(targetOf(item.tool!)).toBeUndefined();
  });
});

describe("compactCount", () => {
  it("rounds to what fits in the footer", () => {
    expect(compactCount(999)).toBe("999");
    expect(compactCount(18234)).toBe("18.2k");
    expect(compactCount(123456)).toBe("123k");
    expect(compactCount(1234)).toBe("1.2k");
    expect(compactCount(2_500_000)).toBe("2.5M");
  });
});
