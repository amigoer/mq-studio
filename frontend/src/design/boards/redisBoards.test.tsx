import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every Redis Stream board, through the states it can be in.
 *
 * The i18n sweep renders each board once with nothing connected, which covers
 * the offline notice and the strings. It cannot cover the rest: a board only
 * touches its data on the path where data exists, and that is exactly where a
 * missing attribute or an empty list throws. Each board is rendered here
 * against a stubbed hook so loading, failed, connected-but-empty and populated
 * all get exercised.
 *
 * The stubs return the shapes internal/driver/redisstream actually sends, so a
 * driver that renames an attribute key breaks a board test rather than a
 * screenshot.
 */

type BrokerState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  online: boolean;
  refresh: () => Promise<void>;
};

function stateOf<T>(over: Partial<BrokerState<T>>): BrokerState<T> {
  return {
    data: null,
    loading: false,
    refreshing: false,
    error: null,
    online: true,
    refresh: async () => {},
    ...over,
  };
}

const streamsState = vi.hoisted(() => ({ current: null as unknown }));
const streamDetailState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/hooks/redis/useRedisStreams", () => ({
  useRedisStreams: () => streamsState.current,
  useRedisStreamDetail: () => streamDetailState.current,
}));

let render: (element: React.ReactElement) => string;
let StreamsRedis: typeof import("./topics/StreamsRedis").StreamsRedis;

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

  const [server, streams, ui, i18n, settings] = await Promise.all([
    import("react-dom/server"),
    import("./topics/StreamsRedis"),
    import("@/components"),
    import("@/i18n"),
    import("@/hooks/useSettings"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = (node) =>
    server.renderToStaticMarkup(
      <ui.ConfirmProvider>
        <settings.SettingsProvider>{node}</settings.SettingsProvider>
      </ui.ConfirmProvider>,
    );
  StreamsRedis = streams.StreamsRedis;
});

/** A stream as internal/driver/redisstream/destination.go sends one. */
const orders = {
  id: 1,
  ref: { namespace: "", name: "orders:events" },
  partitions: -1,
  subscribers: 3,
  depth: 1204771,
  rateIn: -1,
  rateOut: -1,
  lastUpdated: "",
  attributes: {
    lastGeneratedId: "1756454646018-0",
    firstEntryId: "1756368200104-0",
    lastEntryId: "1756454646018-0",
    entriesAdded: "1300000",
    radixTreeKeys: "11842",
    radixTreeNodes: "23118",
    memoryBytes: "90177536",
  },
};

/** A stream nothing has been written to, and no group reads. */
const fresh = {
  id: 2,
  ref: { namespace: "", name: "orders:new" },
  partitions: -1,
  subscribers: 0,
  depth: 0,
  rateIn: -1,
  rateOut: -1,
  lastUpdated: "",
  attributes: { lastGeneratedId: "0-0" },
};

describe("the Redis streams board", () => {
  it("says nothing is dialled rather than showing an empty list", () => {
    streamsState.current = stateOf({ online: false, data: null });
    streamDetailState.current = stateOf({ online: false, data: null });
    const html = render(<StreamsRedis />);
    expect(html).toContain("未连接");
    expect(html).not.toContain("orders:events");
  });

  it("says it is reading while the first load is in flight", () => {
    streamsState.current = stateOf({ loading: true });
    streamDetailState.current = stateOf({ loading: true });
    expect(render(<StreamsRedis />)).toContain("正在读取");
  });

  /*
   * A failed read must not look like an empty keyspace. The driver reports a
   * reason the user can act on as an i18n key, and the board resolves it -
   * putting the raw key on screen would be worse than the English.
   */
  it("shows the driver's reason when the read failed", () => {
    streamsState.current = stateOf({ error: "mq.redis-stream.degraded.credentials" });
    streamDetailState.current = stateOf({});
    const html = render(<StreamsRedis />);
    expect(html).not.toContain("mq.redis-stream.degraded.credentials");
    expect(html).toContain("拒绝");
  });

  /*
   * The scan succeeding and finding nothing is its own state, and the message
   * says where to look: the key pattern on the connection is what narrows it,
   * so an empty list is usually a pattern rather than an empty server.
   */
  it("says the scan found nothing, and points at the key pattern", () => {
    streamsState.current = stateOf({ data: [] });
    streamDetailState.current = stateOf({ data: null });
    const html = render(<StreamsRedis />);
    expect(html).toContain("键匹配模式");
    expect(html).toContain("找到 0 个");
  });

  it("lists the streams with their length, groups and last id", () => {
    streamsState.current = stateOf({ data: [orders, fresh] });
    streamDetailState.current = stateOf({ data: null });
    const html = render(<StreamsRedis />);
    expect(html).toContain("orders:events");
    expect(html).toContain("orders:new");
    expect(html).toContain("1756454646018-0");
    expect(html).toContain("找到 2 个");
  });

  /*
   * The figure the canvas's invented maxlen column was reaching for. Redis
   * stores no bound, but entries-added minus the length is how much trimming
   * has actually taken away, and that is a real number.
   */
  it("shows how much has been trimmed away, and a dash where it cannot know", () => {
    streamsState.current = stateOf({ data: [orders, fresh] });
    streamDetailState.current = stateOf({ data: null });
    const html = render(<StreamsRedis />);
    // 1300000 added, 1204771 held.
    expect(html).toContain("95,229");
    // The fresh stream reports no entries-added, so the cell is a dash rather
    // than a zero: "not reported" and "nothing trimmed" are different facts.
    expect(html).toContain("—");
  });

  it("renders a stream that has never held an entry without inventing ids", () => {
    streamsState.current = stateOf({ data: [fresh] });
    streamDetailState.current = stateOf({ data: null });
    const html = render(<StreamsRedis />);
    expect(html).toContain("orders:new");
    // No first or last entry exists, so nothing may be drawn for them.
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});
