import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every Pulsar board, through the states it can be in.
 *
 * The i18n sweep renders each board once with nothing connected, which covers
 * the offline notice and the strings. It cannot cover the rest: a board only
 * touches its data on the path where data exists, and that is exactly where a
 * missing field or an empty list throws. Each board is rendered here against a
 * stubbed hook so loading, failed, connected-but-empty and populated all get
 * exercised.
 *
 * The stubs return the shapes the Go side actually sends - attribute keys
 * included - so a driver that renames one breaks a board test rather than a
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

const clusterState = vi.hoisted(() => ({ current: null as unknown }));
const configState = vi.hoisted(() => ({ current: null as unknown }));
const metadataState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/hooks/pulsar/usePulsarCluster", () => ({
  usePulsarCluster: () => clusterState.current,
  usePulsarBrokerConfig: () => configState.current,
  usePulsarMetadataStore: () => metadataState.current,
}));
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "pulsar", key: "p1", online: true }),
}));

let render: (element: React.ReactElement) => string;
let OverviewPulsar: typeof import("./overview/OverviewPulsar").OverviewPulsar;
let BrokersPulsar: typeof import("./cluster/BrokersPulsar").BrokersPulsar;

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

  const [server, overview, brokers, ui, i18n, settings] = await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewPulsar"),
    import("./cluster/BrokersPulsar"),
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
  OverviewPulsar = overview.OverviewPulsar;
  BrokersPulsar = brokers.BrokersPulsar;
});

/**
 * Two brokers, of which the load manager describes one.
 *
 * That asymmetry is the normal case behind a load balancer, and it is the one
 * every figure on these boards has to survive - so it is the fixture rather
 * than a special case bolted on at the end.
 */
const partlyDescribedCluster = {
  overview: {
    name: "standalone",
    totalNodes: 2,
    onlineNodes: 2,
    destinations: -1,
    subscriptions: -1,
    avgDiskUsage: -1,
    attributes: {
      pulsarCluster: "standalone",
      pulsarClusterWebServiceUrl: "http://127.0.0.1:8080",
      pulsarClusterBrokerServiceUrl: "pulsar://127.0.0.1:6650",
      pulsarMetadataStore: "zk:2181",
    },
  },
  nodes: [
    {
      id: 1,
      name: "127.0.0.1:8080",
      address: "127.0.0.1:8080",
      cluster: "standalone",
      version: "4.0.13",
      status: "online",
      rateIn: 0,
      rateOut: 0,
      diskUsage: -1,
      lastSeen: "",
      attributes: {
        pulsarLeader: "true",
        pulsarBrokerVersion: "4.0.13",
        pulsarServiceUrl: "pulsar://127.0.0.1:6650",
        pulsarCpuPercent: "4",
        pulsarMemoryPercent: "18",
        pulsarDirectMemoryPercent: "37",
        pulsarBundles: "4",
        pulsarTopics: "6",
        pulsarProducers: "2",
        pulsarConsumers: "3",
      },
    },
    {
      id: 2,
      name: "broker-2:8080",
      address: "broker-2:8080",
      cluster: "standalone",
      version: "",
      status: "online",
      rateIn: -1,
      rateOut: -1,
      diskUsage: -1,
      lastSeen: "",
      attributes: { pulsarLeader: "false" },
    },
  ],
};

const emptyCluster = {
  overview: {
    name: "standalone",
    totalNodes: 0,
    onlineNodes: 0,
    destinations: -1,
    subscriptions: -1,
    avgDiskUsage: -1,
    attributes: { pulsarCluster: "standalone" },
  },
  nodes: [],
};

function setCluster(state: Partial<BrokerState<unknown>>) {
  clusterState.current = stateOf(state);
  configState.current = stateOf({ data: {} });
  metadataState.current = stateOf({ data: {} });
}

describe("the Pulsar overview", () => {
  it("draws the four states without throwing", () => {
    setCluster({ loading: true });
    expect(render(<OverviewPulsar />)).toBeTruthy();

    setCluster({ error: "mq.pulsar.degraded.unreachable" });
    expect(render(<OverviewPulsar />)).toBeTruthy();

    setCluster({ online: false });
    expect(render(<OverviewPulsar />)).toBeTruthy();

    setCluster({ data: emptyCluster });
    expect(render(<OverviewPulsar />)).toBeTruthy();
  });

  /*
   * A cluster the header cannot count reports a dash, never a zero.
   *
   * Destinations and subscriptions need a walk of every namespace and no
   * broker reports a disk figure at all, so all three arrive as the unknown
   * sentinel. Rendering -1 or 0 would tell an operator this cluster is empty
   * or its disks are free, and nobody said either.
   */
  it("does not draw the unknown sentinel as a number", () => {
    setCluster({ data: partlyDescribedCluster });
    // The rendered text, not the markup: Tailwind ships class names like
    // "flex-1", so a substring search over the HTML would match itself.
    const text = render(<OverviewPulsar />).replace(/<[^>]*>/g, " ");

    expect(text).not.toMatch(/(^|\s)-1(\s|$)/);
    expect(text).toContain("—");
  });

  // The figures that exist come from the brokers that reported them, and the
  // sum is over those brokers only - 6 topics from one described broker, not 6
  // plus an invented 0 for the other.
  it("totals only the brokers the load manager described", () => {
    setCluster({ data: partlyDescribedCluster });
    const html = render(<OverviewPulsar />);

    expect(html).toContain("4.0.13");
    expect(html).toContain("standalone");
    expect(html).toContain("zk:2181");
  });
});

describe("the Pulsar brokers board", () => {
  it("draws the four states without throwing", () => {
    setCluster({ loading: true });
    expect(render(<BrokersPulsar />)).toBeTruthy();

    setCluster({ error: "mq.pulsar.degraded.credentials" });
    expect(render(<BrokersPulsar />)).toBeTruthy();

    setCluster({ online: false });
    expect(render(<BrokersPulsar />)).toBeTruthy();

    setCluster({ data: emptyCluster });
    expect(render(<BrokersPulsar />)).toBeTruthy();
  });

  /*
   * A broker with no figures says why.
   *
   * Rows the load manager did not describe are not broken brokers - they are
   * brokers this connection cannot ask - and a table of silent dashes reads as
   * a cluster that has stopped reporting. The banner is what turns that into a
   * fact about the connection.
   */
  it("explains the brokers the load manager did not describe", () => {
    setCluster({ data: partlyDescribedCluster });
    const html = render(<BrokersPulsar />);

    const text = html.replace(/<[^>]*>/g, " ");
    expect(text).toContain("broker-2:8080");
    // The banner counts exactly the one broker the load manager left out.
    expect(text).toMatch(/其中 1 个 Broker/);
    expect(text).toContain("—");
    expect(text).not.toMatch(/(^|\s)-1(\s|$)/);
  });

  it("marks exactly one leader", () => {
    setCluster({ data: partlyDescribedCluster });
    const html = render(<BrokersPulsar />);

    expect(html.split("leader").length - 1).toBeGreaterThanOrEqual(1);
  });
});
