import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every MQTT board, through the states it can be in.
 *
 * The i18n sweep renders each board once with nothing connected, which covers
 * the offline notice and the strings. It cannot cover the rest: a board only
 * touches its data on the path where data exists, and that is exactly where a
 * missing field or an empty list throws.
 *
 * MQTT needs a fifth state the other families do not have. Which figures a
 * broker reports depends on which tier answered - a plain Mosquitto publishes
 * a $SYS tree and cannot count topics, a default EMQX refuses $SYS and answers
 * over HTTP - so "connected and reporting nothing" is an ordinary state here
 * rather than a fault, and a board that renders a zero for it would be making
 * a claim the broker never made.
 *
 * The stubs return the shapes the Go side actually sends, attribute keys
 * included, so a driver that renames one breaks a board test rather than a
 * screenshot nobody is looking at.
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

const brokerState = vi.hoisted(() => ({ current: null as unknown }));
const topicsState = vi.hoisted(() => ({ current: null as unknown }));
const clientsState = vi.hoisted(() => ({ current: null as unknown }));
const subscriptionsState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/hooks/mqtt/useMqttBroker", () => ({
  useMqttBroker: () => brokerState.current,
  useMqttTopics: () => topicsState.current,
  useMqttClients: () => clientsState.current,
  useMqttSubscriptions: () => subscriptionsState.current,
}));
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "mqtt", key: "m1", online: true }),
}));

let render: (element: React.ReactElement) => string;
let OverviewMqtt: typeof import("./overview/OverviewMqtt").OverviewMqtt;

beforeAll(async () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  vi.stubGlobal("window", {
    _wails: { environment: { OS: "darwin" } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  vi.stubGlobal("localStorage", storage);

  const [server, overview, ui, i18n, settings] = await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewMqtt"),
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
  OverviewMqtt = overview.OverviewMqtt;
});

/** A Mosquitto: a full $SYS tree, and no way to count topics. */
const mosquitto = {
  overview: {
    name: "127.0.0.1:1883",
    totalNodes: 1,
    onlineNodes: 1,
    // MQTT cannot enumerate topics, so the driver sends the not-reported
    // marker rather than a zero.
    destinations: -1,
    subscriptions: 128,
    avgDiskUsage: -1,
    attributes: {
      brokerVersion: "mosquitto version 2.1.2",
      uptimeSeconds: "3600",
      clientsConnected: "12",
      clientsTotal: "40",
      clientsMaximum: "51",
      retainedCount: "55",
      messagesReceived: "9000",
      messagesSent: "12000",
      messagesDropped: "3",
      bytesReceived: "480000",
      bytesSent: "512000",
      heapCurrent: "839641",
      sysTopics: "$SYS/broker/version\tmosquitto version 2.1.2\n$SYS/broker/uptime\t3600 seconds\n",
    },
  },
  nodes: [
    {
      id: 1,
      name: "127.0.0.1:1883",
      address: "127.0.0.1:1883",
      cluster: "",
      version: "mosquitto version 2.1.2",
      status: "online",
      rateIn: 2,
      rateOut: 4,
      diskUsage: -1,
      lastSeen: "2026-09-02 03:00:00",
      attributes: { uptimeSeconds: "3600" },
    },
  ],
};

/** An EMQX: no $SYS tree, and a topic count only its API can give. */
const emqx = {
  overview: {
    name: "http://127.0.0.1:18083",
    totalNodes: 1,
    onlineNodes: 1,
    destinations: 5,
    subscriptions: 7,
    avgDiskUsage: -1,
    attributes: {
      brokerVersion: "6.2.3",
      clientsConnected: "2",
      retainedCount: "4",
      sharedSubscriptions: "1",
      messagesReceived: "11",
      messagesSent: "12",
      messagesDropped: "1",
      bytesReceived: "175",
      bytesSent: "86",
      // No uptime, no heap and no $SYS tree: EMQX refuses that subscription
      // by default and its API reports uptime per node instead.
      sysTopics: "",
    },
  },
  nodes: [],
};

describe("the MQTT overview board", () => {
  it("renders while the broker is still being read", () => {
    brokerState.current = stateOf({ loading: true });
    expect(render(<OverviewMqtt />)).toContain("<");
  });

  it("renders when the broker could not be read", () => {
    brokerState.current = stateOf({ error: "broker refused the subscription" });
    expect(render(<OverviewMqtt />)).toContain("broker refused the subscription");
  });

  it("shows what a broker with a $SYS tree reports", () => {
    brokerState.current = stateOf({ data: mosquitto });
    const html = render(<OverviewMqtt />);

    expect(html).toContain("mosquitto version 2.1.2");
    expect(html).toContain("12");
    expect(html).toContain("55");
    // The whole tree is shown verbatim, because a broker publishes counters
    // this app has never heard of.
    expect(html).toContain("$SYS/broker/uptime");
  });

  /*
   * The reason every tile reads through a not-reported check.
   *
   * MQTT cannot enumerate topics. A plain broker therefore has no count, and
   * drawing 0 would say there are none - which is a claim about the broker
   * rather than about what it reports.
   */
  it("leaves a figure the broker cannot produce blank rather than zero", () => {
    brokerState.current = stateOf({ data: mosquitto });
    const html = render(<OverviewMqtt />);
    expect(html).toContain("—");
  });

  it("shows what a broker with no $SYS tree reports over its api", () => {
    brokerState.current = stateOf({ data: emqx });
    const html = render(<OverviewMqtt />);

    expect(html).toContain("6.2.3");
    // The topic count is the one figure only the management tier can give.
    expect(html).toContain("5");
    // And with no tree, the panel says so rather than drawing an empty table.
    expect(html).not.toContain("$SYS/broker");
  });

  // Connected and reporting nothing is an ordinary state on MQTT, not a fault.
  it("renders a broker that reports nothing at all", () => {
    brokerState.current = stateOf({
      data: {
        overview: {
          name: "127.0.0.1:1883",
          totalNodes: 1,
          onlineNodes: 1,
          destinations: -1,
          subscriptions: -1,
          avgDiskUsage: -1,
          attributes: {},
        },
        nodes: [],
      },
    });
    expect(render(<OverviewMqtt />)).toContain("—");
  });
});
