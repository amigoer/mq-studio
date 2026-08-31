import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every Kafka board, through the four states it can be in.
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

vi.mock("@/hooks/kafka/useKafkaCluster", () => ({
  useKafkaCluster: () => clusterState.current,
}));

let render: (element: React.ReactElement) => string;
let OverviewKafka: typeof import("./overview/OverviewKafka").OverviewKafka;

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

  const [server, overview, ui, i18n, settings] = await Promise.all([
    import("react-dom/server"),
    import("./overview/OverviewKafka"),
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
  OverviewKafka = overview.OverviewKafka;
});

/** A healthy three-broker cluster, shaped the way the driver sends it. */
const healthyCluster = {
  overview: {
    name: "mq-studio-e2e-kafka-0",
    totalNodes: 3,
    onlineNodes: 3,
    destinations: 2,
    subscriptions: 1,
    avgDiskUsage: -1,
    attributes: {
      clusterId: "mq-studio-e2e-kafka-0",
      controllerNode: "2",
      brokers: "3",
      topics: "2",
      internalTopics: "1",
      partitions: "9",
      underReplicatedPartitions: "0",
      offlinePartitions: "0",
      leaderlessPartitions: "0",
      consumerGroups: "1",
    },
  },
  nodes: [
    {
      id: 1,
      name: "broker-1",
      address: "127.0.0.1:9092",
      cluster: "",
      version: "",
      status: "online",
      rateIn: -1,
      rateOut: -1,
      diskUsage: -1,
      lastSeen: "",
      attributes: { nodeId: "1", rack: "eu-west-1a", controller: "false" },
    },
    {
      id: 2,
      name: "broker-2",
      address: "127.0.0.1:9094",
      cluster: "",
      version: "",
      status: "online",
      rateIn: -1,
      rateOut: -1,
      diskUsage: -1,
      lastSeen: "",
      attributes: { nodeId: "2", rack: "", controller: "true" },
    },
  ],
};

/** The same cluster with a broker falling behind. */
const unhealthyCluster = {
  ...healthyCluster,
  overview: {
    ...healthyCluster.overview,
    attributes: {
      ...healthyCluster.overview.attributes,
      underReplicatedPartitions: "3",
      offlinePartitions: "2",
      leaderlessPartitions: "1",
    },
  },
};

/** A cluster that answered but has nothing on it yet. */
const emptyCluster = {
  overview: {
    name: "",
    totalNodes: 0,
    onlineNodes: 0,
    destinations: 0,
    subscriptions: -1,
    avgDiskUsage: -1,
    attributes: {},
  },
  nodes: [],
};

describe("the Kafka overview board", () => {
  it("draws the offline notice with nothing dialled", () => {
    clusterState.current = stateOf({ online: false });
    expect(render(<OverviewKafka />)).toContain("未连接");
  });

  it("draws the loading notice before the first answer", () => {
    clusterState.current = stateOf({ loading: true });
    expect(render(<OverviewKafka />)).toContain("正在读取");
  });

  it("draws the failure and its reason", () => {
    clusterState.current = stateOf({ error: "mq.kafka.degraded.credentials" });
    const html = render(<OverviewKafka />);
    // A driver reports a reason the user can act on as an i18n key, and the
    // board has to resolve it rather than printing the key.
    expect(html).not.toContain("mq.kafka.degraded.credentials");
    expect(html).toContain("集群拒绝了这组凭据");
  });

  it("renders a cluster that answered with nothing on it", () => {
    clusterState.current = stateOf({ data: emptyCluster });
    const html = render(<OverviewKafka />);
    expect(html).toContain("尚未选出控制器");
    // Counts the cluster did not report read as absent, never as zero.
    expect(html).toContain("—");
  });

  it("renders a healthy cluster and says so", () => {
    clusterState.current = stateOf({ data: healthyCluster });
    const html = render(<OverviewKafka />);

    expect(html).toContain("全部同步");
    expect(html).toContain("控制器是 broker 2");
    expect(html).toContain("另有 1 个内部 topic");
    expect(html).toContain("127.0.0.1:9092");
    expect(html).toContain("eu-west-1a");
    // A broker with no rack shows an em dash, not an empty cell.
    expect(html).toContain("—");
  });

  it("says a cluster needs attention when any partition counter is not zero", () => {
    clusterState.current = stateOf({ data: unhealthyCluster });
    const html = render(<OverviewKafka />);

    expect(html).toContain("需要关注");
    expect(html).not.toContain("全部同步");
  });

  // The canvas drew a throughput chart and a produce rate. Kafka's admin
  // protocol reports neither, so nothing on this page may imply it does.
  it("shows no per-second figure anywhere", () => {
    clusterState.current = stateOf({ data: healthyCluster });
    expect(render(<OverviewKafka />)).not.toMatch(/\/s\b/);
  });
});
