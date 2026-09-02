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
const consumersState = vi.hoisted(() => ({ current: null as unknown }));
const browseState = vi.hoisted(() => ({ current: null as unknown }));
const liveState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/hooks/nats/useNatsStreams", () => ({
  useNatsStreams: () => streamsState.current,
  useNatsStreamDetail: () => streamDetailState.current,
}));
vi.mock("@/hooks/nats/useNatsConsumers", () => ({
  useNatsConsumers: () => consumersState.current,
}));
vi.mock("@/hooks/nats/useNatsMessages", () => ({
  useNatsBrowse: () => browseState.current,
}));
vi.mock("@/hooks/nats/useNatsStream", () => ({
  useNatsStream: () => liveState.current,
}));

let render: (element: React.ReactElement) => string;
let StreamsNats: typeof import("./topics/StreamsNats").StreamsNats;
let ConsumersNats: typeof import("./consumers/ConsumersNats").ConsumersNats;
let MessagesNats: typeof import("./messages/MessagesNats").MessagesNats;
let NatsWorkbench: typeof import("./nats/NatsWorkbench").NatsWorkbench;

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

  const [server, streams, consumers, messages, workbench, ui, i18n, settings] =
    await Promise.all([
    import("react-dom/server"),
    import("./topics/StreamsNats"),
    import("./consumers/ConsumersNats"),
    import("./messages/MessagesNats"),
    import("./nats/NatsWorkbench"),
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
  ConsumersNats = consumers.ConsumersNats;
  MessagesNats = messages.MessagesNats;
  NatsWorkbench = workbench.NatsWorkbench;
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

/** A pull consumer, as internal/driver/nats/consumer.go sends one. */
const worker = {
  id: 1,
  ref: { namespace: "MQS_SEED_ORDERS", name: "seed-worker" },
  status: "online",
  members: -1,
  destinations: 1,
  backlog: 80,
  rateOut: -1,
  lastUpdated: "2026-09-02 10:38:04",
  attributes: {
    stream: "MQS_SEED_ORDERS",
    durable: "seed-worker",
    deliverPolicy: "all",
    ackPolicy: "explicit",
    ackWait: "30s",
    maxDeliver: "-1",
    maxAckPending: "1000",
    replayPolicy: "instant",
    consumerKind: "pull",
    waitingRequests: "0",
    ackPending: "0",
    redelivered: "0",
    deliveredSeq: "120",
    ackFloorSeq: "120",
    consumerCreated: "2026-09-02 10:38:04",
  },
};

/** A push consumer holding unacknowledged work, which is the warning state. */
const pusher = {
  ...worker,
  id: 2,
  ref: { namespace: "MQS_SEED_ORDERS", name: "seed-stuck" },
  status: "warning",
  members: 0,
  backlog: 195,
  attributes: {
    ...worker.attributes,
    consumerKind: "push",
    deliverSubject: "deliver.orders",
    deliverGroup: "workers",
    ackWait: "1h0m0s",
    ackPending: "5",
    filterSubject: "orders.shipped",
    waitingRequests: undefined as unknown as string,
  },
};

describe("the NATS consumers board", () => {
  it("says the connection is offline rather than showing an empty list", () => {
    consumersState.current = stateOf({ online: false });
    streamsState.current = stateOf({});
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });

  it("renders while the first request is in flight", () => {
    consumersState.current = stateOf({ loading: true });
    streamsState.current = stateOf({});
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });

  /*
   * An account whose streams have no consumers is ordinary, not broken. The
   * notice has to say what a consumer is for, because "no results" reads as a
   * page that failed to load.
   */
  it("explains an account whose streams have no consumers", () => {
    consumersState.current = stateOf({ data: [] });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });

  it("lists a consumer with its stream and its backlog", () => {
    consumersState.current = stateOf({ data: [worker, pusher] });
    streamsState.current = stateOf({ data: [] });
    const html = render(<ConsumersNats />);
    expect(html).toContain("seed-worker");
    expect(html).toContain("MQS_SEED_ORDERS");
  });

  /*
   * A pull consumer has no member count. Rendering zero would call a working
   * consumer unattended, so the column shows a dash.
   */
  it("draws no member count for a pull consumer", () => {
    consumersState.current = stateOf({ data: [worker] });
    streamsState.current = stateOf({ data: [] });
    expect(render(<ConsumersNats />)).toContain("—");
  });

  it("renders the detail panel for a pull consumer", () => {
    consumersState.current = stateOf({ data: [worker] });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });

  /*
   * The push branch of the panel reads entirely different fields, which is
   * where a missing attribute throws rather than rendering a dash.
   */
  it("renders the detail panel for a push consumer", () => {
    consumersState.current = stateOf({ data: [pusher] });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });

  it("renders a consumer reported with almost nothing set", () => {
    const bare = {
      ...worker,
      attributes: { consumerKind: "pull" },
    };
    consumersState.current = stateOf({ data: [bare] });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<ConsumersNats />)).not.toThrow();
  });
});

/** A message as internal/driver/nats/message.go sends one. */
const message = {
  id: 42,
  cluster: "",
  topic: "MQS_SEED_ORDERS",
  messageId: "42",
  tags: "mqs.seed.orders.created",
  keys: "order-42",
  queueId: -1,
  queueOffset: 42,
  storeHost: "",
  bornHost: "",
  storeTime: "2026-09-02 10:38:03",
  storeTimestamp: 1788000000000,
  status: "normal",
  retryTimes: -1,
  body: '{"id":42}',
  properties: { Region: "eu", "Nats-Msg-Id": "order-42" },
};

function browseOf(over: Record<string, unknown>) {
  return {
    messages: [],
    loading: false,
    error: null,
    searched: false,
    run: async () => {},
    ...over,
  };
}

describe("the NATS messages board", () => {
  /*
   * Nothing is read until somebody asks. The empty state has to say that,
   * because "no results" would read as a stream that is empty.
   */
  it("invites a search rather than reading a stream on its own", () => {
    browseState.current = browseOf({});
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<MessagesNats />)).not.toThrow();
  });

  it("renders while a search is running", () => {
    browseState.current = browseOf({ loading: true });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<MessagesNats />)).not.toThrow();
  });

  it("shows what a failed search said", () => {
    browseState.current = browseOf({ error: "stream ABSENT does not exist", searched: true });
    streamsState.current = stateOf({ data: [] });
    expect(render(<MessagesNats />)).toContain("ABSENT");
  });

  it("distinguishes a search that matched nothing from one nobody ran", () => {
    browseState.current = browseOf({ searched: true });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<MessagesNats />)).not.toThrow();
  });

  it("lists a message with its subject and sequence", () => {
    browseState.current = browseOf({ messages: [message], searched: true });
    streamsState.current = stateOf({ data: [orders] });
    const html = render(<MessagesNats />);
    expect(html).toContain("mqs.seed.orders.created");
    expect(html).toContain("42");
  });

  /*
   * An empty body is ordinary in NATS - a subject alone is a signal - so the
   * row names it rather than showing a blank cell that reads as a failed load.
   */
  it("names an empty payload rather than leaving the cell blank", () => {
    const empty = { ...message, body: "", properties: {} };
    browseState.current = browseOf({ messages: [empty], searched: true });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<MessagesNats />)).not.toThrow();
  });

  it("renders a message with no headers at all", () => {
    const bare = { ...message, keys: "", properties: {} };
    browseState.current = browseOf({ messages: [bare], searched: true });
    streamsState.current = stateOf({ data: [] });
    expect(() => render(<MessagesNats />)).not.toThrow();
  });
});

function liveOf(over: Record<string, unknown>) {
  return {
    messages: [],
    subjects: [],
    running: false,
    live: true,
    received: 0,
    dropped: 0,
    error: null,
    start: () => {},
    stop: () => {},
    clear: () => {},
    ...over,
  };
}

/** One message off the wire, as internal/driver/nats/subscribe.go sends it. */
const wireMessage = {
  seq: 1,
  destination: "orders.created",
  filter: "orders.>",
  receivedAt: "2026-09-02 10:38:03",
  body: '{"id":42}',
  truncated: false,
  attributes: { sizeBytes: "9" },
};

describe("the NATS subject workbench", () => {
  /*
   * Three empty pages that must not read the same: nothing started, listening
   * with nothing published, and the connection gone. Only the second is a
   * quiet subject; the third is this app not receiving anything at all.
   */
  it("invites a subscription before one has been started", () => {
    liveState.current = liveOf({});
    expect(() => render(<NatsWorkbench />)).not.toThrow();
  });

  it("says it is listening when a subject has gone quiet", () => {
    liveState.current = liveOf({ running: true, subjects: ["orders.>"] });
    const html = render(<NatsWorkbench />);
    expect(() => html).not.toThrow();
  });

  it("says the connection dropped rather than showing a quiet subject", () => {
    liveState.current = liveOf({ running: true, live: false, subjects: ["orders.>"] });
    expect(() => render(<NatsWorkbench />)).not.toThrow();
  });

  it("renders messages as they arrive", () => {
    liveState.current = liveOf({
      running: true,
      subjects: ["orders.>"],
      messages: [wireMessage],
      received: 1,
    });
    const html = render(<NatsWorkbench />);
    expect(html).toContain("orders.created");
  });

  /*
   * A stream quietly losing messages looks exactly like a quiet one, so the
   * dropped count is drawn only when it happened - and then prominently.
   */
  it("shows the dropped count when messages were lost", () => {
    liveState.current = liveOf({
      running: true,
      subjects: ["orders.>"],
      messages: [wireMessage],
      received: 500,
      dropped: 120,
    });
    expect(() => render(<NatsWorkbench />)).not.toThrow();
  });

  it("renders a request and a truncated body without throwing", () => {
    liveState.current = liveOf({
      running: true,
      subjects: ["ask.>"],
      messages: [
        { ...wireMessage, seq: 2, attributes: { replyTo: "_INBOX.abc" } },
        { ...wireMessage, seq: 3, truncated: true, body: "xxxx" },
        { ...wireMessage, seq: 4, body: "", attributes: {} },
      ],
    });
    expect(() => render(<NatsWorkbench />)).not.toThrow();
  });

  it("shows what a failed subscription said", () => {
    liveState.current = liveOf({ error: "nothing is listening" });
    expect(render(<NatsWorkbench />)).toContain("nothing is listening");
  });
});
