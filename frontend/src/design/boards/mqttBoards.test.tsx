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
const streamState = vi.hoisted(() => ({ current: null as unknown }));
const protocolFive = vi.hoisted(() => ({ current: true }));

vi.mock("@/hooks/mqtt/useMqttBroker", () => ({
  useMqttBroker: () => brokerState.current,
  useMqttTopics: () => topicsState.current,
  useMqttClients: () => clientsState.current,
  useMqttSubscriptions: () => subscriptionsState.current,
  useMqttProtocolIsFive: () => protocolFive.current,
}));
vi.mock("@/hooks/mqtt/useMqttStream", () => ({
  useMqttStream: () => streamState.current,
}));
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "mqtt", key: "m1", online: true }),
}));

let render: (element: React.ReactElement) => string;
let OverviewMqtt: typeof import("./overview/OverviewMqtt").OverviewMqtt;
let MqttWorkbench: typeof import("./mqtt/MqttWorkbench").MqttWorkbench;
let ProducerMqtt: typeof import("./producer/ProducerMqtt").ProducerMqtt;

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

  const [server, overview, workbench, producer, ui, i18n, settings] = await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewMqtt"),
    import("./mqtt/MqttWorkbench"),
    import("./producer/ProducerMqtt"),
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
  MqttWorkbench = workbench.MqttWorkbench;
  ProducerMqtt = producer.ProducerMqtt;
});

/** A stream as the hook reports it. */
function streamOf(over: Record<string, unknown> = {}) {
  return {
    messages: [],
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

/** A message as the driver sends it, attribute keys included. */
const arrival = {
  seq: 1,
  destination: "sensors/room-1/temperature",
  filter: "sensors/#",
  receivedAt: "2026-09-02 03:24:07",
  body: '{"c":21.5}',
  truncated: false,
  attributes: { qos: "1", retained: "false" },
};

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

describe("the MQTT subscribe workbench", () => {
  it("says nothing is subscribed before anything is", () => {
    streamState.current = streamOf();
    const html = render(<MqttWorkbench />);
    expect(html).toContain("尚未订阅");
  });

  it("shows a message with the filter that matched it", () => {
    streamState.current = streamOf({ running: true, received: 1, messages: [arrival] });
    const html = render(<MqttWorkbench />);

    expect(html).toContain("sensors/room-1/temperature");
    expect(html).toContain("21.5");
    // A wildcard subscription cannot be read back from the topic alone.
    expect(html).toContain("sensors/#");
  });

  /*
   * The buffer behind this page is bounded, so a stream faster than the page
   * loses messages. Saying so is the whole reason the driver counts them: a
   * gap in the traffic and a gap in what was kept look identical otherwise.
   */
  it("says how many messages it had to drop", () => {
    streamState.current = streamOf({ running: true, received: 500, dropped: 120, messages: [arrival] });
    expect(render(<MqttWorkbench />)).toContain("120");
  });

  /*
   * A dropped session and a quiet broker both show an empty list. Only one of
   * them is a reason to go and look at something.
   */
  it("says when the session dropped rather than letting it read as silence", () => {
    streamState.current = streamOf({ running: true, live: false, messages: [] });
    expect(render(<MqttWorkbench />)).toContain("会话已断开");
  });

  // A retained value can be hours old and arrives looking like something that
  // just happened.
  it("marks a retained message as retained", () => {
    streamState.current = streamOf({
      running: true,
      messages: [{ ...arrival, attributes: { qos: "1", retained: "true" } }],
    });
    expect(render(<MqttWorkbench />)).toContain("保留");
  });

  it("renders a failed subscription", () => {
    streamState.current = streamOf({ error: "broker refused the subscription to \"a/#\"" });
    expect(render(<MqttWorkbench />)).toContain("broker refused the subscription");
  });
});

describe("the MQTT send console", () => {
  /*
   * The 5.0 property fields are hidden rather than disabled on a 3.1.1
   * connection, because they are not a setting that connection could turn on:
   * the version was chosen when the connection was made, and the two versions
   * are carried by different client libraries.
   */
  it("offers the 5.0 properties only on a 5.0 connection", () => {
    protocolFive.current = true;
    expect(render(<ProducerMqtt />)).toContain("MQTT 5.0");

    protocolFive.current = false;
    const html = render(<ProducerMqtt />);
    expect(html).toContain("MQTT 3.1.1");
    expect(html).not.toContain("关联数据");
  });

  it("explains that retain leaves something behind", () => {
    protocolFive.current = true;
    // The only way to leave state on an MQTT broker, and permanent until
    // something overwrites it.
    expect(render(<ProducerMqtt />)).toContain("最后已知值");
  });
});
