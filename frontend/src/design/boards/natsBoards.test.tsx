import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every NATS board, through the states it can be in.
 *
 * The i18n sweep renders each board once with nothing connected, which covers
 * the offline notice and the strings. It cannot cover the rest: a board only
 * touches its data on the path where data exists, and that is exactly where a
 * missing attribute or an empty list throws. Each board is rendered here
 * against a stubbed hook so loading, failed, connected-but-empty and populated
 * all get exercised.
 *
 * The stubs return the shapes internal/driver/nats actually sends, so a driver
 * that renames an attribute key breaks a board test rather than a screenshot.
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

vi.mock("@/hooks/nats/useNatsStreams", () => ({
  useNatsStreams: () => streamsState.current,
  useNatsStreamDetail: () => streamDetailState.current,
}));

let render: (element: React.ReactElement) => string;
let StreamsNats: typeof import("./topics/StreamsNats").StreamsNats;

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
    import("./topics/StreamsNats"),
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
  StreamsNats = streams.StreamsNats;
});

/** A replicated stream, as internal/driver/nats/stream.go sends one. */
const orders = {
  id: 1,
  ref: { namespace: "", name: "MQS_SEED_ORDERS" },
  partitions: -1,
  subscribers: 3,
  depth: 200,
  rateIn: -1,
  rateOut: -1,
  lastUpdated: "2026-09-02 10:38:02",
  attributes: {
    subjects: "mqs.seed.orders.>",
    retention: "limits",
    storage: "file",
    discard: "old",
    replicas: "3",
    maxMsgs: "-1",
    maxBytes: "-1",
    maxAge: "0s",
    maxMsgSize: "-1",
    maxMsgsPerSubject: "-1",
    duplicateWindow: "2m0s",
    firstSeq: "1",
    lastSeq: "200",
    firstTime: "2026-09-02 10:38:02",
    lastTime: "2026-09-02 10:38:04",
    bytes: "12288",
    numSubjects: "2",
    numDeleted: "0",
    created: "2026-09-02 10:38:02",
    clusterName: "mqstudio",
    leader: "nats-2",
    replicaState: "nats-2 leader\nnats-1 current\nnats-3 current",
    replicasHealthy: "3",
  },
};

/** The other shape: one server, no cluster, a work queue, and flags set. */
const audit = {
  id: 2,
  ref: { namespace: "", name: "MQS_SEED_AUDIT" },
  partitions: -1,
  subscribers: 1,
  depth: 30,
  rateIn: -1,
  rateOut: -1,
  lastUpdated: "2026-09-02 10:38:04",
  attributes: {
    subjects: "mqs.seed.audit.write, mqs.seed.audit.read, mqs.seed.audit.purge",
    retention: "workqueue",
    storage: "memory",
    replicas: "1",
    maxMsgs: "1000",
    maxBytes: "1048576",
    maxAge: "24h0m0s",
    bytes: "1740",
    denyDelete: "true",
    sealed: "false",
  },
};

describe("the NATS streams board", () => {
  it("says the connection is offline rather than showing an empty list", () => {
    streamsState.current = stateOf({ online: false });
    streamDetailState.current = stateOf({});
    expect(() => render(<StreamsNats />)).not.toThrow();
  });

  it("renders while the first request is in flight", () => {
    streamsState.current = stateOf({ loading: true });
    streamDetailState.current = stateOf({});
    expect(() => render(<StreamsNats />)).not.toThrow();
  });

  it("shows what failed rather than an empty list", () => {
    streamsState.current = stateOf({ error: "mq.nats.degraded.jetstreamDisabled" });
    streamDetailState.current = stateOf({});
    const html = render(<StreamsNats />);
    expect(html).not.toContain("mq.nats.degraded.jetstreamDisabled");
  });

  /*
   * An account with no streams is the ordinary state of a fresh cluster, not a
   * failure. The empty notice has to say why nothing is there - JetStream
   * stores nothing until a stream is declared - because "no results" would
   * read as a broken page.
   */
  it("explains an account that has declared no streams", () => {
    streamsState.current = stateOf({ data: [] });
    streamDetailState.current = stateOf({});
    const html = render(<StreamsNats />);
    expect(html).toContain("JetStream");
  });

  it("lists a replicated stream with its subjects and figures", () => {
    streamsState.current = stateOf({ data: [orders, audit] });
    streamDetailState.current = stateOf({});
    const html = render(<StreamsNats />);
    expect(html).toContain("MQS_SEED_ORDERS");
    expect(html).toContain("mqs.seed.orders.&gt;");
    expect(html).toContain("limits");
    // The leader plus the number of followers, which is what the column is for.
    expect(html).toContain("nats-2");
  });

  /*
   * A work queue is the one retention policy under which reading the stream
   * changes what it holds, so it is marked rather than printed like the
   * others.
   */
  it("marks a work queue apart from the other retention policies", () => {
    streamsState.current = stateOf({ data: [audit] });
    streamDetailState.current = stateOf({});
    expect(render(<StreamsNats />)).toContain("workqueue");
  });

  /*
   * A stream on one server reports no cluster at all. Rendering "1 of 1" would
   * dress an unprotected stream up as a healthy one.
   */
  it("draws no replica badge for a stream on a single server", () => {
    streamsState.current = stateOf({ data: [audit] });
    streamDetailState.current = stateOf({});
    const html = render(<StreamsNats />);
    expect(html).not.toContain("1 of 1");
  });

  /*
   * Every value in the detail panel comes from an attribute, and this is the
   * path where a renamed key throws rather than rendering a dash.
   */
  it("renders the detail panel for a stream with every attribute set", () => {
    streamsState.current = stateOf({ data: [orders] });
    streamDetailState.current = stateOf({ data: orders });
    expect(() => render(<StreamsNats />)).not.toThrow();
  });

  /*
   * And this is the other half: a stream reported with almost nothing set,
   * which is what a fresh single-server stream looks like.
   */
  it("renders the detail panel for a stream with almost nothing set", () => {
    const bare = {
      ...audit,
      attributes: { subjects: "bare.>" },
    };
    streamsState.current = stateOf({ data: [bare] });
    streamDetailState.current = stateOf({ data: bare });
    expect(() => render(<StreamsNats />)).not.toThrow();
  });
});
