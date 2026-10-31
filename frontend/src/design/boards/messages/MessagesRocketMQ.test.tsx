import { beforeAll, describe, expect, it, vi } from "vitest";

/** The RocketMQ message sheet, rendered against a stubbed trace. */

vi.mock("@/hooks/useBrokerData", () => ({
  useBrokerData: () => ({
    data: [],
    loading: false,
    refreshing: false,
    error: null,
    online: true,
    refresh: async () => {},
  }),
}));
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "rocketmq", key: "r1", online: true }),
}));

let render: (element: React.ReactElement) => string;
let MessageSheet: typeof import("./MessagesRocketMQ").MessageSheet;
let i18n: typeof import("@/i18n").default;

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

  const [server, board, ui, i18nModule, settings] = await Promise.all([
    import("react-dom/server"),
    import("./MessagesRocketMQ"),
    import("@/components"),
    import("@/i18n"),
    import("@/hooks/useSettings"),
  ]);
  i18n = i18nModule.default;
  render = (node) =>
    server.renderToStaticMarkup(
      <ui.ConfirmProvider>
        <settings.SettingsProvider>{node}</settings.SettingsProvider>
      </ui.ConfirmProvider>,
    );
  MessageSheet = board.MessageSheet;
});

const message = (body: string) =>
  ({
    id: 1,
    cluster: "DefaultCluster",
    topic: "order-create",
    messageId: "7F0000010B2A18B4AAC2",
    tags: "paid",
    keys: "order-1001",
    queueId: 2,
    queueOffset: 88244,
    storeHost: "127.0.0.1:10911",
    bornHost: "127.0.0.1:60262",
    storeTime: "2026-10-31T07:40:33Z",
    storeTimestamp: 0,
    status: "normal",
    retryTimes: 0,
    body,
    properties: {},
  }) as never;

/** The body section's label, as text: the span SectionLabel puts its children in. */
function bodyLabel(markup: string): string {
  const labels = [...markup.matchAll(/<span class="min-w-0 flex-1">([\s\S]*?)<\/span><span class="inline-flex/g)];
  const text = labels.map((match) => (match[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const body = text.find((label) => /^(Body|消息体) /.test(label));
  if (body == null) throw new Error(`no body label in ${JSON.stringify(text)}`);
  return body;
}

describe("MessageSheet body label", () => {
  it.each([
    ["en", "Body · JSON"],
    ["zh", "消息体 · JSON"],
  ])("names a JSON body's format once (%s)", async (lang, expected) => {
    await i18n.changeLanguage(lang);
    const markup = render(<MessageSheet message={message('{"orderId":1001}')} topic="order-create" onClose={() => {}} />);
    expect(bodyLabel(markup)).toBe(expected);
  });

  it("names the format the body was detected as, not JSON", async () => {
    await i18n.changeLanguage("en");
    const markup = render(<MessageSheet message={message("plain text payload")} topic="order-create" onClose={() => {}} />);
    expect(bodyLabel(markup)).toBe("Body · Text");
  });
});
