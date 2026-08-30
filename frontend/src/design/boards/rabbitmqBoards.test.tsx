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

vi.mock("@/hooks/rabbitmq/useRabbitOverview", () => ({
  useRabbitOverview: () => overviewState.current,
}));

let render: (element: React.ReactElement) => string;
let OverviewRabbitMQ: typeof import("./overview/OverviewRabbitMQ").OverviewRabbitMQ;

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

  const [server, overview, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewRabbitMQ"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = server.renderToStaticMarkup;
  OverviewRabbitMQ = overview.OverviewRabbitMQ;
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

const queue = (name: string, ready: string, unacked: string, consumers: number) => ({
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
