import type {
  AgentEvent,
  AgentItem,
  AgentSnapshot,
  AgentToolItem,
  AgentUsage,
} from "@/api/agent";

/**
 * A conversation as the dock holds it: Go's items, and how far along the
 * numbered events it is.
 */
export type Conversation = {
  session: string;
  seq: number;
  title: string;
  running: boolean;
  model: string;
  items: AgentItem[];
  usage: AgentUsage;
};

export const NO_USAGE: AgentUsage = { input: 0, output: 0 };

/** A conversation nothing has happened in yet. */
export function opened(session: string, model: string): Conversation {
  return { session, seq: 0, title: "", running: false, model, items: [], usage: NO_USAGE };
}

export function fromSnapshot(snapshot: AgentSnapshot): Conversation {
  return {
    session: snapshot.session,
    seq: snapshot.seq,
    title: snapshot.title ?? "",
    running: snapshot.running,
    model: snapshot.model,
    items: snapshot.items ?? [],
    usage: snapshot.usage ?? NO_USAGE,
  };
}

/**
 * Applies one event, or answers "gap" when one was missed.
 *
 * Events are numbered per conversation from 1 and have to be applied in that
 * order: a delta means nothing without the item it extends. One already
 * applied is skipped, which is what a snapshot taken mid-run leaves behind;
 * one that skips a number means only a snapshot can say what came between.
 */
export function applyEvent(state: Conversation, event: AgentEvent): Conversation | "gap" {
  if (event.session !== state.session || event.seq <= state.seq) return state;
  if (event.seq !== state.seq + 1) return "gap";
  const next: Conversation = { ...state, seq: event.seq };
  switch (event.kind) {
    case "item": {
      const item = event.item;
      if (item == null) return "gap";
      const at = state.items.findIndex((one) => one.id === item.id);
      next.items =
        at < 0 ? [...state.items, item] : state.items.map((one, index) => (index === at ? item : one));
      return next;
    }
    case "delta": {
      const at = state.items.findIndex((one) => one.id === event.itemId);
      if (at < 0) return "gap";
      next.items = state.items.map((one, index) =>
        index === at ? { ...one, text: (one.text ?? "") + (event.text ?? "") } : one,
      );
      return next;
    }
    case "run":
      next.running = event.running;
      if (event.model != null && event.model !== "") next.model = event.model;
      if (event.usage != null) next.usage = event.usage;
      return next;
    case "title":
      next.title = event.text ?? "";
      return next;
    default:
      return next;
  }
}

/** What a conversation is called: the title it was given, or its first question. */
export function titleOf(conversation: Conversation): string {
  if (conversation.title !== "") return conversation.title;
  return conversation.items.find((item) => item.kind === "user")?.text?.split("\n")[0] ?? "";
}

/** What the dock draws, in order: an item each, except reads in a row. */
export type Block =
  | { kind: "user" | "text" | "thinking" | "notice" | "write"; item: AgentItem }
  | { kind: "reads"; items: AgentItem[] };

/**
 * Groups the items for drawing. Reads in a row fold into one line that opens
 * to show each; a write stands on its own, because it is a question to the
 * person while it waits and a change to their broker once it has run.
 */
export function blocksOf(items: readonly AgentItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "tool": {
        if (item.tool == null) break;
        if (writes(item.tool)) {
          blocks.push({ kind: "write", item });
          break;
        }
        const last = blocks[blocks.length - 1];
        if (last?.kind === "reads") last.items.push(item);
        else blocks.push({ kind: "reads", items: [item] });
        break;
      }
      case "user":
      case "text":
      case "thinking":
      case "notice":
        blocks.push({ kind: item.kind, item });
        break;
    }
  }
  return blocks;
}

export const writes = (tool: AgentToolItem): boolean =>
  tool.blast === "mutate" || tool.blast === "destructive";

/** The question a run is waiting on, if any. */
export function waitingAsk(items: readonly AgentItem[]): AgentItem | undefined {
  return items.find((item) => item.tool?.state === "waiting" && item.tool.ask != null);
}

/* The argument that names what a call is about, in the order a reader looks
   for it: a group's progress is about the group, not its topic. */
const TARGET_KEYS = ["group", "destination", "name", "messageId", "namespace"] as const;

/** What a call is about, as its card names it. */
export function targetOf(tool: AgentToolItem): string | undefined {
  const input: unknown = tool.input;
  if (input == null || typeof input !== "object") return undefined;
  for (const key of TARGET_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** Every token a conversation has cost, whether or not the cache served it. */
export const tokensOf = (usage: AgentUsage): number =>
  usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);

/** 18234 as "18.2k": the footer has room for a glance, not a ledger. */
export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 100_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** How long a set of calls took together, in seconds. */
export function secondsOf(items: readonly AgentItem[]): string {
  const millis = items.reduce((sum, item) => sum + (item.tool?.ms ?? 0), 0);
  return `${(millis / 1000).toFixed(millis < 10_000 ? 2 : 1)}s`;
}
