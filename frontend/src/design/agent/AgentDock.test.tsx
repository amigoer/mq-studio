import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentItem, AgentProviderView, AgentSettingsView } from "@/api/agent";
import type { Conversation } from "./conversation";

/**
 * The dock in each of its states, in both languages.
 *
 * Static rendering runs no effects, so the assistant is handed in as it would
 * stand at each point - which is also all the dock reads. The imports are
 * dynamic because the shell reaches the Wails runtime at module load, which
 * wants a `window` this environment has to install first.
 */

const service: AgentProviderView = {
  id: "p1",
  name: "Ollama",
  kind: "openai",
  baseURL: "http://127.0.0.1:11434/v1",
  model: "qwen3:14b",
  proxy: "",
  fallback: false,
  apiKeyConfigured: false,
};

const settings = (consented: string[], providers = [service]): AgentSettingsView => ({
  providers,
  default: "",
  effort: "medium",
  writes: "approve",
  bodyBytes: 2048,
  bodyLimits: [0, 2048, 8192, 32768],
  consented,
});

const tool = (id: string, name: string, blast: string, state: string, extra: object = {}): AgentItem =>
  ({
    id,
    kind: "tool",
    tool: { call: id, name, title: name, blast, input: { connection: 1, name: "orders" }, state, ...extra },
  }) as AgentItem;

const everything: Conversation = {
  session: "s1",
  seq: 12,
  running: false,
  model: "qwen3:14b",
  usage: { input: 900, output: 120, cacheRead: 3600 },
  items: [
    { id: "1", kind: "user", text: "Why is orders behind?", context: { connection: 1, page: "queues" } },
    { id: "2", kind: "thinking", text: "Check the queue first." },
    tool("3", "destination_detail", "read", "done", { ms: 12, output: { depth: 0 } }),
    tool("4", "destinations_list", "read", "failed", { result: "connection 1 is not open" }),
    { id: "5", kind: "text", text: "Nothing is behind.\n\n| Queue | Ready |\n| --- | ---: |\n| `orders` | 0 |" },
    tool("6", "destination_create", "mutate", "waiting", {
      connection: { id: 1, name: "scratch", family: "rabbitmq" },
      ask: { id: "6", kind: "approve", caveat: "every consumer sees it at once" },
    }),
    tool("7", "destination_delete", "destructive", "waiting", {
      ask: { id: "7", kind: "confirm", question: "Delete orders on scratch (rabbitmq)?" },
    }),
    tool("8", "message_publish", "mutate", "done", { approved: "session", result: "published to orders", ms: 40 }),
    tool("9", "destination_purge", "destructive", "declined", { result: "not done: the person declined it" }),
    { id: "10", kind: "notice", notice: "limit", text: "25" },
    { id: "11", kind: "notice", notice: "failed", reason: "auth", text: "invalid key" },
  ] as AgentItem[],
};

let markupOf: (state: {
  settings: AgentSettingsView | null;
  conversation: Conversation | null;
  consented: boolean;
}) => string;
let useLanguage: (lang: "zh" | "en") => Promise<void>;
let dock: typeof import("./AgentDock");
let blocks: typeof import("./Blocks");

beforeAll(async () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  vi.stubGlobal("window", {
    _wails: { environment: { OS: "darwin" } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("localStorage", storage);

  const [{ renderToStaticMarkup }, loadedDock, loadedBlocks, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./AgentDock"),
    import("./Blocks"),
    import("@/i18n"),
  ]);
  dock = loadedDock;
  blocks = loadedBlocks;
  markupOf = (state) => {
    const provider = state.settings?.providers[0] ?? null;
    const assistant = {
      ...state,
      provider,
      draft: "",
      setDraft() {},
      refresh: () => Promise.resolve(state.settings),
      consent: () => Promise.resolve(),
      send: () => Promise.resolve(),
      carryOn: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      decide: () => Promise.resolve(),
      startOver() {},
    } as unknown as import("@/hooks/useAssistant").Assistant;
    return renderToStaticMarkup(
      <dock.AgentDock
        assistant={assistant}
        where={{
          connection: { id: 1, name: "scratch", protocol: "rabbitmq" },
          page: { id: "queues", label: "Queues" },
        }}
        connections={[]}
        pageLabel={() => "Queues"}
        onClose={() => {}}
        onOpenSettings={() => {}}
      />,
    );
  };
  useLanguage = async (lang) => {
    await i18n.default.changeLanguage(lang);
  };
});

const STATES = [
  ["with no service", { settings: settings([], []), conversation: null, consented: false }],
  ["before agreeing", { settings: settings([]), conversation: null, consented: false }],
  ["agreed and empty", { settings: settings(["p1"]), conversation: null, consented: true }],
  ["mid-conversation", { settings: settings(["p1"]), conversation: everything, consented: true }],
] as const;

describe.each(["zh", "en"] as const)("the dock in %s", (lang) => {
  it.each(STATES)("resolves every key it renders %s", async (_, state) => {
    await useLanguage(lang);
    expect(markupOf(state).match(/\b(agent|page|shell)\.[a-zA-Z][\w.]*/g)).toBeNull();
  });
});

describe("the dock", () => {
  it("leaves no Chinese behind in English", async () => {
    await useLanguage("en");
    for (const [, state] of STATES) {
      expect(markupOf(state).replace(/<[^>]*>/g, "").match(/[一-鿿]+/g)).toBeNull();
    }
  });

  it("asks before anything is sent, and says where it would go", async () => {
    await useLanguage("en");
    const html = markupOf(STATES[1][1]);
    expect(html).toContain("Agree and start");
    expect(html).toContain("127.0.0.1:11434/v1");
    expect(html).toContain("up to 2 KB each");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it("draws each kind of item a conversation holds", async () => {
    await useLanguage("en");
    const html = markupOf(STATES[3][1]);
    for (const text of [
      "Why is orders behind?",
      "Thinking",
      "Called 2 tools",
      "<table",
      "Waiting for your approval",
      "scratch (RabbitMQ)",
      "every consumer sees it at once",
      "Don&#x27;t ask again in this conversation",
      "Delete orders on scratch (rabbitmq)?",
      "Approved for this conversation",
      "Declined",
      "Paused after 25 tool calls",
      "The service refused the key",
      "4.6k tokens",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("offers to carry on only from the last notice", async () => {
    await useLanguage("en");
    const html = markupOf(STATES[3][1]);
    expect(html.match(/>Continue</g)).toBeNull();
    expect(html.match(/>Retry</g)).toHaveLength(1);
  });
});

describe("sends", () => {
  it("sends on Enter, and on nothing an input method is still composing", () => {
    expect(dock.sends({ key: "Enter", shiftKey: false })).toBe(true);
    expect(dock.sends({ key: "Enter", shiftKey: true })).toBe(false);
    expect(dock.sends({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    // WebKit reports the candidate-picking Enter as keyCode 229 and not always as composing.
    expect(dock.sends({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(dock.sends({ key: "a", shiftKey: false })).toBe(false);
  });
});

describe("contextOf", () => {
  it("carries what the person did not take off", () => {
    const where = {
      connection: { id: 3, name: "orders", protocol: "rocketmq" as const },
      page: { id: "consumers", label: "Consumers" },
      namespace: "prod",
      selected: { kind: "group" as const, name: "legacy-sync" },
    };
    expect(dock.contextOf(where, new Set())).toEqual({
      connection: 3,
      page: "consumers",
      namespace: "prod",
      selected: { kind: "group", name: "legacy-sync" },
    });
    expect(dock.contextOf(where, new Set(["page", "selected"]))).toEqual({ connection: 3, namespace: "prod" });
    expect(dock.contextOf({}, new Set())).toEqual({});
  });
});

describe("fieldsOf", () => {
  it("lists a write's arguments without the connection, short enough to read", () => {
    const fields = blocks.fieldsOf({
      connection: 1,
      group: "legacy-sync",
      timestamp: 1_790_000_000_000,
      force: false,
      body: "x".repeat(400),
    });
    expect(fields.map(([key]) => key)).toEqual(["group", "timestamp", "body"]);
    expect(fields[1]?.[1]).toBe(new Date(1_790_000_000_000).toLocaleString());
    expect(fields[2]?.[1]).toHaveLength(241);
    expect(blocks.fieldsOf("{\"connection\": 1, \"na")).toEqual([]);
  });
});
