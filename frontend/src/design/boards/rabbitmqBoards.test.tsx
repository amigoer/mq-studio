import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every RabbitMQ board, through the four states it can be in.
 *
 * The i18n sweep renders each board once with nothing connected, which covers
 * the offline notice and the strings. It cannot cover the rest: a board only
 * touches its data on the path where data exists, and that is exactly where a
 * missing field or an empty list throws. Each board is rendered here against a
 * stubbed hook so loading, failed, connected-but-empty and populated all get
 * exercised.
 *
 * The stubs return the shapes the Go side actually sends, so a driver that
 * changes an attribute key breaks a board test rather than a screenshot.
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

const overviewState = vi.hoisted(() => ({ current: null as unknown }));
const queuesState = vi.hoisted(() => ({ current: null as unknown }));
const routingState = vi.hoisted(() => ({ current: null as unknown }));
const clientsState = vi.hoisted(() => ({ current: null as unknown }));
const clusterState = vi.hoisted(() => ({ current: null as unknown }));
const messagesState = vi.hoisted(() => ({ current: null as unknown }));
const deadLetterState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/hooks/rabbitmq/useRabbitOverview", () => ({
  useRabbitOverview: () => overviewState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitQueues", () => ({
  useRabbitQueues: () => queuesState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitRouting", () => ({
  useRabbitRouting: () => routingState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitClients", () => ({
  useRabbitClients: () => clientsState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitCluster", () => ({
  useRabbitCluster: () => clusterState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitMessages", () => ({
  useRabbitMessages: () => messagesState.current,
}));
vi.mock("@/hooks/rabbitmq/useRabbitDeadLetters", () => ({
  useRabbitDeadLetters: () => deadLetterState.current,
}));

/**
 * The boards are rendered inside the providers main.tsx gives them, because a
 * board that performs a destructive action reaches for the confirm dialog at
 * render time. Effects do not run under static rendering, so no provider here
 * reaches the bridge.
 */
let render: (element: React.ReactElement) => string;
let OverviewRabbitMQ: typeof import("./overview/OverviewRabbitMQ").OverviewRabbitMQ;
let QueuesRabbitMQ: typeof import("./topics/QueuesRabbitMQ").QueuesRabbitMQ;
let ExchangesRabbitMQ: typeof import("./topics/ExchangesRabbitMQ").ExchangesRabbitMQ;
let ChannelsRabbitMQ: typeof import("./consumers/ChannelsRabbitMQ").ChannelsRabbitMQ;
let NodesRabbitMQ: typeof import("./cluster/NodesRabbitMQ").NodesRabbitMQ;
let MessagesRabbitMQ: typeof import("./messages/MessagesRabbitMQ").MessagesRabbitMQ;
let DlqRabbitMQ: typeof import("./dlq/DlqRabbitMQ").DlqRabbitMQ;

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

  const [server, overview, queues, exchanges, clients, cluster, messages, dlq, ui, i18n] =
    await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewRabbitMQ"),
    import("./topics/QueuesRabbitMQ"),
    import("./topics/ExchangesRabbitMQ"),
    import("./consumers/ChannelsRabbitMQ"),
    import("./cluster/NodesRabbitMQ"),
    import("./messages/MessagesRabbitMQ"),
    import("./dlq/DlqRabbitMQ"),
    import("@/components"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = (node) =>
    server.renderToStaticMarkup(<ui.ConfirmProvider>{node}</ui.ConfirmProvider>);
  OverviewRabbitMQ = overview.OverviewRabbitMQ;
  QueuesRabbitMQ = queues.QueuesRabbitMQ;
  ExchangesRabbitMQ = exchanges.ExchangesRabbitMQ;
  ChannelsRabbitMQ = clients.ChannelsRabbitMQ;
  NodesRabbitMQ = cluster.NodesRabbitMQ;
  MessagesRabbitMQ = messages.MessagesRabbitMQ;
  DlqRabbitMQ = dlq.DlqRabbitMQ;
});

const census = {
  clusterName: "rabbit-prod",
  version: "4.1.2",
  runtimeVersion: "27.2",
  queues: 46,
  exchanges: 12,
  connections: 128,
  channels: 342,
  consumers: 7,
  ready: 1139,
  unacknowledged: 16,
  total: 1155,
  rates: { publish: 2980, deliver: 2975, ack: 2970, redeliver: 4, unroutable: 2 },
};

const node = (over: Record<string, string> = {}) => ({
  name: "rabbit@one",
  address: "rabbit@one",
  version: "4.1.2",
  status: "online",
  rateIn: -1,
  rateOut: -1,
  diskUsage: -1,
  lastSeen: "",
  attributes: {
    memoryUsed: "536870912",
    memoryLimit: "1073741824",
    memoryAlarm: "false",
    diskFree: "10737418240",
    diskFreeLimit: "1073741824",
    diskFreeAlarm: "false",
    partitions: "",
    ...over,
  },
});

const queue = (
  name: string,
  ready: string,
  unacked: string,
  consumers: number,
  extra: Record<string, string> = {},
) => ({
  ref: { namespace: "/", name },
  partitions: -1,
  subscribers: consumers,
  depth: Number(ready) + Number(unacked),
  rateIn: 0,
  rateOut: 0,
  attributes: {
    messagesReady: ready,
    messagesUnacknowledged: unacked,
    queueType: "quorum",
    durable: "true",
    ...extra,
  },
});

describe("the RabbitMQ overview board", () => {
  const renderWith = (over: Partial<BrokerState<unknown>>) => {
    overviewState.current = stateOf(over);
    return render(<OverviewRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty cluster", () => {
    const html = renderWith({ online: false });
    expect(html).not.toContain("rabbit-prod");
    expect(html.length).toBeGreaterThan(0);
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("draws the failure rather than a page of zeroes", () => {
    const html = renderWith({ error: "management API returned 500 Internal Server Error" });
    expect(html).not.toContain("rabbit-prod");
  });

  // Connected, answered, and the broker is genuinely empty. This is the path
  // that throws when a board assumes its lists have rows.
  it("survives a broker with nothing on it", () => {
    const html = renderWith({
      data: {
        census: { ...census, queues: 0, exchanges: 0, ready: 0, unacknowledged: 0, total: 0 },
        nodes: [],
        queues: [],
        lastUpdated: new Date(0),
      },
    });
    expect(html).toContain("rabbit-prod");
  });

  it("reports the broker's totals and the queues holding the most", () => {
    const html = renderWith({
      data: {
        census,
        nodes: [node()],
        queues: [queue("order.settle.q", "982", "14", 4), queue("audit.q", "120", "0", 2)],
        lastUpdated: new Date(0),
      },
    });

    expect(html).toContain("rabbit-prod");
    expect(html).toContain("1,139");
    expect(html).toContain("order.settle.q");
    // Sorted by what each queue is holding, so the deepest is first.
    expect(html.indexOf("order.settle.q")).toBeLessThan(html.indexOf("audit.q"));
    // Memory is a real fraction of the node's own watermark: 512Mi of 1Gi.
    expect(html).toContain("50%");
  });

  /*
   * Ready messages with nobody attached is the one state that needs a person,
   * and it must not read the same as a queue that is merely busy.
   */
  it("separates a backlog with no consumer from one being worked", () => {
    const abandoned = renderWith({
      data: {
        census,
        nodes: [node()],
        queues: [queue("orphan.q", "500", "0", 0)],
        lastUpdated: new Date(0),
      },
    });
    const worked = renderWith({
      data: {
        census,
        nodes: [node()],
        queues: [queue("busy.q", "500", "0", 3)],
        lastUpdated: new Date(0),
      },
    });
    expect(abandoned).not.toBe(worked);
    expect(abandoned).toContain("无消费者");
  });

  // A split brain outranks everything else the page has to say.
  it("names the peers a partitioned node has lost", () => {
    const html = renderWith({
      data: {
        census,
        nodes: [node({ partitions: "rabbit@two,rabbit@three" })],
        queues: [],
        lastUpdated: new Date(0),
      },
    });
    expect(html).toContain("rabbit@two");
    expect(html).toContain("rabbit@three");
  });
});

describe("the RabbitMQ queues board", () => {
  const renderWith = (over: Partial<BrokerState<unknown>>) => {
    queuesState.current = stateOf(over);
    return render(<QueuesRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty queue list", () => {
    expect(() => renderWith({ online: false })).not.toThrow();
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("draws the failure rather than an empty cluster", () => {
    const html = renderWith({ error: "management API returned 500" });
    expect(html).not.toContain("order.settle.q");
  });

  it("says the virtual host is empty rather than showing a blank table", () => {
    const html = renderWith({ data: [] });
    expect(html).toContain("还没有队列");
  });

  it("lists queues deepest first", () => {
    const html = renderWith({
      data: [queue("shallow.q", "5", "0", 1), queue("deep.q", "980", "14", 4)],
    });
    expect(html.indexOf("deep.q")).toBeLessThan(html.indexOf("shallow.q"));
    expect(html).toContain("980");
  });

  /*
   * The tags are read off what the queue was declared with. A queue carrying
   * none is the ordinary case and must not sprout tags of its own.
   */
  it("tags a queue from its declared arguments", () => {
    const html = renderWith({
      data: [
        queue("ttl.q", "1", "0", 1, {
          arguments: JSON.stringify({ "x-message-ttl": 30000, "x-dead-letter-exchange": "dlx" }),
        }),
      ],
    });
    expect(html).toContain("DLX");
    expect(html).toContain("TTL");
  });

  // A queue holding messages with nobody attached is the row that needs a
  // person, and the consumer count is where that shows.
  it("survives a queue with no consumers and no arguments", () => {
    expect(() =>
      renderWith({ data: [queue("bare.q", "500", "0", 0, { arguments: "" })] }),
    ).not.toThrow();
  });
});

const exchange = (name: string, type: string, extra: Record<string, string> = {}) => ({
  ref: { namespace: "/", name },
  partitions: -1,
  subscribers: -1,
  depth: -1,
  rateIn: 0,
  rateOut: 0,
  attributes: { exchangeType: type, durable: "true", internal: "false", ...extra },
});

const binding = (
  source: string,
  destination: string,
  routingKey: string,
  kind = "queue",
  args: Record<string, string> = {},
) => ({
  id: 1,
  namespace: "/",
  source,
  destination,
  destinationKind: kind,
  routingKey,
  arguments: args,
});

describe("the RabbitMQ exchanges board", () => {
  const renderWith = (over: Partial<BrokerState<unknown>>) => {
    routingState.current = stateOf(over);
    return render(<ExchangesRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty topology", () => {
    expect(() => renderWith({ online: false })).not.toThrow();
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("says the virtual host has none rather than showing a blank table", () => {
    const html = renderWith({ data: { exchanges: [], bindings: [] } });
    expect(html).toContain("没有交换机");
  });

  // Every virtual host has the built-in amq.* exchanges. Showing them by
  // default would bury the handful an operator actually declared.
  it("hides the built-in exchanges until asked for them", () => {
    const html = renderWith({
      data: {
        exchanges: [exchange("amq.topic", "topic"), exchange("ex.order", "topic")],
        bindings: [],
      },
    });
    expect(html).toContain("ex.order");
    expect(html).not.toContain("amq.topic");
  });

  it("counts the bindings leaving each exchange", () => {
    const html = renderWith({
      data: {
        exchanges: [exchange("ex.order", "topic")],
        bindings: [
          binding("ex.order", "order.settle.q", "order.created"),
          binding("ex.order", "order.notify.q", "order.updated"),
          binding("ex.other", "elsewhere.q", "x"),
        ],
      },
    });
    // Two, not three: the third leaves a different exchange.
    expect(html).toContain("ex.order");
    expect(html).toMatch(/>2</);
  });

  // A fanout binds with no routing key at all; how that reads is covered by
  // mq/rabbitmq/routing.test.ts, since it renders in the detail panel.
  it("survives a binding with no routing key", () => {
    expect(() =>
      renderWith({
        data: {
          exchanges: [exchange("ex.broadcast", "fanout")],
          bindings: [binding("ex.broadcast", "audit.q", "")],
        },
      }),
    ).not.toThrow();
  });

  // An exchange with nothing bound silently drops everything published to it,
  // which is worth saying rather than showing an empty box.
  it("says what an unbound exchange does with its messages", () => {
    const html = renderWith({
      data: { exchanges: [exchange("ex.orphan", "direct")], bindings: [] },
    });
    expect(html).toContain("ex.orphan");
  });

  it("survives an exchange carrying arguments and an alternate exchange", () => {
    expect(() =>
      renderWith({
        data: {
          exchanges: [
            exchange("ex.ae", "topic", {
              arguments: JSON.stringify({ "alternate-exchange": "ex.unrouted" }),
            }),
          ],
          bindings: [],
        },
      }),
    ).not.toThrow();
  });
});

const connection = (over: Record<string, unknown> = {}) => ({
  name: "10.0.0.5:51234 -> 10.0.0.1:5672",
  clientName: "",
  namespace: "/",
  user: "app",
  node: "rabbit@one",
  peerHost: "10.0.0.5",
  peerPort: 51234,
  protocol: "AMQP 0-9-1",
  state: "running",
  channels: 2,
  tls: false,
  cipher: "",
  heartbeatSec: 60,
  recvBytes: 1024,
  sendBytes: 2048,
  recvByteRate: 100,
  sendByteRate: 200,
  connectedAtMs: 0,
  blockedBy: "",
  ...over,
});

const channel = (over: Record<string, unknown> = {}) => ({
  name: "10.0.0.5:51234 -> 10.0.0.1:5672 (1)",
  number: 1,
  connection: "10.0.0.5:51234 -> 10.0.0.1:5672",
  namespace: "/",
  user: "app",
  node: "rabbit@one",
  consumers: 1,
  prefetchCount: 10,
  unacknowledged: 0,
  unconfirmed: 0,
  confirms: false,
  transactional: false,
  flowBlocked: false,
  idleSince: "",
  ...over,
});

describe("the RabbitMQ connections board", () => {
  const renderWith = (over: Partial<BrokerState<unknown>>) => {
    clientsState.current = stateOf(over);
    return render(<ChannelsRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty client list", () => {
    expect(() => renderWith({ online: false })).not.toThrow();
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("says nothing is connected rather than showing a blank table", () => {
    const html = renderWith({ data: { connections: [], channels: [] } });
    expect(html).toContain("没有任何客户端连接");
  });

  /*
   * Most client libraries send no connection name, so the peer address has to
   * carry the row. A blank first column would make every ordinary connection
   * unidentifiable.
   */
  it("falls back to the peer address when a client did not name itself", () => {
    const html = renderWith({ data: { connections: [connection()], channels: [channel()] } });
    expect(html).toContain("10.0.0.5");
  });

  it("prefers the name a client gave itself", () => {
    const html = renderWith({
      data: { connections: [connection({ clientName: "order-service" })], channels: [] },
    });
    expect(html).toContain("order-service");
  });

  // Unacked work is per channel, so the connection row has to add up its own
  // channels rather than showing a figure the connection does not carry.
  it("totals unacknowledged work across a connection's channels", () => {
    const html = renderWith({
      data: {
        connections: [connection()],
        channels: [channel({ unacknowledged: 7 }), channel({ number: 2, unacknowledged: 5 })],
      },
    });
    expect(html).toContain("12");
  });

  /*
   * Blocked outranks flow control. Flow control is the broker asking one
   * channel to slow down; blocked is a resource alarm stopping the whole
   * connection publishing, which is a cluster problem rather than a client
   * one.
   */
  it("reports a resource-blocked connection ahead of flow control", () => {
    const html = renderWith({
      data: {
        connections: [connection({ state: "blocked", blockedBy: "memory" })],
        channels: [channel({ flowBlocked: true })],
      },
    });
    expect(html).toContain("memory");
  });

  it("warns at the top when any channel is under flow control", () => {
    const html = renderWith({
      data: { connections: [connection()], channels: [channel({ flowBlocked: true })] },
    });
    expect(html).toContain("流控");
  });

  it("survives a connection with no channels at all", () => {
    expect(() =>
      renderWith({ data: { connections: [connection({ channels: 0 })], channels: [] } }),
    ).not.toThrow();
  });
});

const health = (over: Record<string, unknown> = {}) => ({
  checks: [
    { id: "alarms", passed: true, unavailable: false, reason: "" },
    { id: "virtualHosts", passed: true, unavailable: false, reason: "" },
  ],
  alarms: [],
  featureFlags: [
    {
      name: "quorum_queue",
      description: "",
      state: "enabled",
      stability: "required",
      providedBy: "rabbit",
      docUrl: "",
    },
  ],
  deprecatedFeatures: [],
  ...over,
});

describe("the RabbitMQ nodes board", () => {
  const renderWith = (over: Partial<BrokerState<unknown>>) => {
    clusterState.current = stateOf(over);
    return render(<NodesRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty cluster", () => {
    expect(() => renderWith({ online: false })).not.toThrow();
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("reports a node with its real memory fraction", () => {
    const html = renderWith({
      data: { nodes: [node()], census, health: health() },
    });
    expect(html).toContain("rabbit@one");
    // 512Mi against a 1Gi watermark.
    expect(html).toContain("50%");
  });

  /*
   * A partition is the one thing that outranks every figure on the page: the
   * cluster is running as two halves and everything below is one half's view.
   */
  it("leads with a partition banner when a node has lost the cluster", () => {
    const html = renderWith({
      data: {
        nodes: [node({ partitions: "rabbit@two" })],
        census,
        health: health(),
      },
    });
    expect(html).toContain("rabbit@two");
  });

  it("leads with an alarm banner while a resource alarm is on", () => {
    const html = renderWith({
      data: {
        nodes: [node()],
        census,
        health: health({ alarms: [{ node: "rabbit@one", resource: "memory" }] }),
      },
    });
    expect(html).toContain("memory");
  });

  /*
   * A check the broker cannot run is not a failure. Showing it as one would
   * have an operator chasing a problem that is not there.
   */
  it("survives health results the broker could not produce", () => {
    expect(() =>
      renderWith({
        data: {
          nodes: [node()],
          census,
          health: health({
            checks: [
              { id: "mirrorSyncCritical", passed: false, unavailable: true, reason: "" },
              { id: "quorumCritical", passed: false, unavailable: false, reason: "too few" },
            ],
          }),
        },
      }),
    ).not.toThrow();
  });

  // Health is allowed to fail on its own, so the node list must still render.
  it("still lists nodes when the health calls failed entirely", () => {
    const html = renderWith({ data: { nodes: [node()], census, health: null } });
    expect(html).toContain("rabbit@one");
  });

  it("survives a broker with no nodes at all", () => {
    expect(() => renderWith({ data: { nodes: [], census, health: null } })).not.toThrow();
  });
});

const browseState = (over: Record<string, unknown> = {}) => ({
  items: [],
  running: false,
  lastCount: null,
  browse: async () => {},
  state: { loading: false, error: null, online: true, refresh: async () => {} },
  ...over,
});

const amqpMessage = (id: number, properties: Record<string, string>, body = "payload") => ({
  id,
  cluster: "",
  topic: "order.settle.q",
  messageId: "",
  tags: "",
  keys: "",
  queueId: -1,
  queueOffset: -1,
  storeHost: "",
  bornHost: "",
  storeTime: "",
  storeTimestamp: 0,
  status: "normal",
  retryTimes: 0,
  body,
  properties,
});

describe("the RabbitMQ messages board", () => {
  const renderWith = (over: Record<string, unknown>) => {
    messagesState.current = browseState(over);
    queuesState.current = stateOf({ data: [queue("order.settle.q", "5", "0", 1)] });
    return render(<MessagesRabbitMQ />);
  };

  /*
   * Browsing is a write in disguise, and the banner is the only place the user
   * finds that out before doing it rather than from a monitoring alert after.
   */
  it("always warns that browsing alters the queue", () => {
    expect(renderWith({})).toContain("浏览会改变队列");
  });

  it("asks for a queue before it has been given one", () => {
    expect(renderWith({})).toContain("先选一个队列");
  });

  it("separates an empty result from never having asked", () => {
    const asked = renderWith({ lastCount: 0 });
    expect(asked).toContain("没有取到消息");
    expect(asked).not.toContain("先选一个队列");
  });

  it("draws a failed browse rather than an empty list", () => {
    const html = renderWith({
      state: { loading: false, error: "consume: NOT_FOUND", online: true, refresh: async () => {} },
    });
    expect(html).not.toContain("order.created");
  });

  it("lists what came back with its routing key and exchange", () => {
    const html = renderWith({
      lastCount: 1,
      items: [
        amqpMessage(1, {
          exchange: "ex.order",
          routingKey: "order.created",
          deliveryMode: "persistent",
          redelivered: "false",
        }),
      ],
    });
    expect(html).toContain("order.created");
    expect(html).toContain("ex.order");
  });

  // The default exchange has no name; a blank cell would leave the reader
  // unable to tell that from a missing value.
  it("names the default exchange rather than leaving the cell blank", () => {
    const html = renderWith({
      lastCount: 1,
      items: [amqpMessage(1, { routingKey: "order.settle.q", deliveryMode: "persistent" })],
    });
    expect(html).toContain("默认交换机");
  });

  it("flags a redelivered or dead-lettered message in the row", () => {
    const html = renderWith({
      lastCount: 1,
      items: [
        amqpMessage(1, {
          redelivered: "true",
          deliveryMode: "transient",
          "header.x-death": "[{count=4, queue=order.settle.q, reason=rejected}]",
        }),
      ],
    });
    expect(html).toContain("x-death 4");
    expect(html).toContain("transient");
  });

  it("survives a message with no properties at all", () => {
    expect(() => renderWith({ lastCount: 1, items: [amqpMessage(1, {})] })).not.toThrow();
  });
});

const deadLetterQueue = (over: Record<string, unknown> = {}) => ({
  namespace: "/",
  name: "dlx.order.q",
  depth: 37,
  consumers: 0,
  sources: [{ queue: "order.settle.q", exchange: "dlx.order", routingKey: "" }],
  ...over,
});

describe("the RabbitMQ dead-letter board", () => {
  const renderWith = (
    topology: Partial<BrokerState<unknown>>,
    browse: Record<string, unknown> = {},
  ) => {
    deadLetterState.current = stateOf(topology);
    messagesState.current = browseState(browse);
    return render(<DlqRabbitMQ />);
  };

  it("draws a not-connected notice rather than an empty topology", () => {
    expect(() => renderWith({ online: false })).not.toThrow();
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  /*
   * Nothing on the broker marks a queue as a dead-letter queue, so an empty
   * result means no queue declares a dead-letter exchange - which is worth
   * saying rather than showing a blank page.
   */
  it("says no queue declares a dead-letter exchange", () => {
    expect(renderWith({ data: [] })).toContain("没有任何队列声明了死信交换机");
  });

  /*
   * The sources are the whole point of the page. A dead-letter queue says how
   * many messages failed; which queues feed it is what says where to look.
   */
  it("names the queues that dead-letter into each one", () => {
    const html = renderWith({ data: [deadLetterQueue()] });
    expect(html).toContain("dlx.order.q");
    expect(html).toContain("order.settle.q");
    expect(html).toContain("dlx.order");
  });

  // An empty dead-letter routing key means the message keeps its original
  // one, which changes where it lands - so it must not read as "no key".
  it("says a message keeps its routing key when none was set", () => {
    expect(renderWith({ data: [deadLetterQueue()] })).toContain("沿用原路由键");
  });

  /*
   * A dead-letter queue with a consumer is a retry pipeline. One without is a
   * backlog nobody is looking at, which is the case that needs a person.
   */
  it("flags a backlog nobody is consuming", () => {
    const html = renderWith({ data: [deadLetterQueue({ consumers: 0, depth: 37 })] });
    expect(html).toContain("无人消费");

    const drained = renderWith({ data: [deadLetterQueue({ consumers: 2, depth: 37 })] });
    expect(drained).not.toContain("无人消费");
  });

  // A queue nothing points at any more will never receive again, and saying so
  // is more useful than an empty source list.
  it("says when nothing dead-letters into a queue any more", () => {
    expect(renderWith({ data: [deadLetterQueue({ sources: [] })] })).toContain(
      "没有队列死信到这里",
    );
  });

  it("survives a topology entry with a null source in it", () => {
    expect(() =>
      renderWith({ data: [deadLetterQueue({ sources: [null] })] }),
    ).not.toThrow();
  });
});
