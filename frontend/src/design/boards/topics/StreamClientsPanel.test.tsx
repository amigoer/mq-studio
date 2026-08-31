import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The stream client panel, through every state a broker can put it in.
 *
 * The panel exists to correct a misreading - a stream read over its own
 * protocol reports zero consumers everywhere else - so the states that matter
 * are the ones where it says nothing: the plugin being off, and there being no
 * stream clients. Both have to explain themselves rather than render blank.
 */

const capability = vi.hoisted(() => ({
  has: true,
  reason: undefined as string | undefined,
}));
const clientsState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/mq/capabilities", () => ({
  useCapabilities: () => ({
    has: () => capability.has,
    degradedReason: () => capability.reason,
    caveat: () => undefined,
    loading: false,
  }),
}));
vi.mock("@/hooks/rabbitmq/useRabbitStreamClients", () => ({
  useRabbitStreamClients: () => clientsState.current,
}));

let render: (element: React.ReactElement) => string;
let StreamClientsPanel: typeof import("./StreamClientsPanel").StreamClientsPanel;

beforeAll(async () => {
  const [server, panel, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./StreamClientsPanel"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = server.renderToStaticMarkup;
  StreamClientsPanel = panel.StreamClientsPanel;
});

const state = (over: Record<string, unknown> = {}) => ({
  data: null,
  loading: false,
  refreshing: false,
  error: null,
  online: true,
  refresh: async () => {},
  ...over,
});

const publisher = (over: Record<string, unknown> = {}) => ({
  reference: "orders-writer",
  connection: "127.0.0.1:51234 -> 127.0.0.1:5552",
  peerHost: "10.0.0.4:51234",
  user: "app",
  node: "rabbit@one",
  published: 90210,
  confirmed: 90210,
  errored: 0,
  ...over,
});

const consumer = (over: Record<string, unknown> = {}) => ({
  connection: "127.0.0.1:51240 -> 127.0.0.1:5552",
  peerHost: "10.0.0.9:51240",
  user: "app",
  node: "rabbit@one",
  offset: 88000,
  lag: 2210,
  consumed: 88000,
  credits: 10,
  active: true,
  ...over,
});

function renderWith(over: Record<string, unknown>, cap = { has: true, reason: undefined as string | undefined }) {
  capability.has = cap.has;
  capability.reason = cap.reason;
  clientsState.current = state(over);
  return render(<StreamClientsPanel vhost="/" name="events" />);
}

describe("the stream client panel", () => {
  it("explains the missing plugin rather than failing the queue", () => {
    const html = renderWith(
      {},
      { has: false, reason: "mq.rabbitmq.degraded.streamPlugin" },
    );
    expect(html).toContain("rabbitmq_stream_management");
  });

  /*
   * A family with no such thing gets no section at all - there is nothing to
   * explain about a protocol that never existed here.
   */
  it("draws nothing when the family has no concept of it", () => {
    expect(renderWith({}, { has: false, reason: undefined })).toBe("");
  });

  it("draws a loading state without touching the data", () => {
    expect(() => renderWith({ loading: true })).not.toThrow();
  });

  it("draws the failure rather than an empty list", () => {
    expect(renderWith({ error: "management API returned 500" })).toContain(
      "management API returned 500",
    );
  });

  /*
   * The whole point: an empty list must not read as "nobody is reading this",
   * because AMQP consumers are counted elsewhere and are not in here.
   */
  it("says where the other consumers are counted when nothing is attached", () => {
    const html = renderWith({ data: { publishers: [], consumers: [] } });
    expect(html).toContain("AMQP");
  });

  it("survives a null in either list", () => {
    expect(() =>
      renderWith({ data: { publishers: [null], consumers: [null] } }),
    ).not.toThrow();
  });

  it("names who is publishing and how much", () => {
    const html = renderWith({ data: { publishers: [publisher()], consumers: [] } });
    expect(html).toContain("orders-writer");
    expect(html).toContain("10.0.0.4:51234");
    expect(html).toContain("90,210");
  });

  /*
   * A publisher with no reference is not deduplicated across a reconnect,
   * which is a fact about the client rather than a missing field.
   */
  it("says a publisher without a reference is not deduplicated", () => {
    const html = renderWith({
      data: { publishers: [publisher({ reference: "" })], consumers: [] },
    });
    expect(html).toContain("重连后不去重");
  });

  it("reports a failed publish rather than only the successes", () => {
    const html = renderWith({
      data: { publishers: [publisher({ errored: 12 })], consumers: [] },
    });
    expect(html).toContain("发送失败");

    const clean = renderWith({ data: { publishers: [publisher()], consumers: [] } });
    expect(clean).not.toContain("发送失败");
  });

  /*
   * A stream keeps its messages after they are read, so there is no depth to
   * fall behind on - lag is the only thing that says a consumer is behind.
   */
  it("reports how far a consumer is behind the end of the stream", () => {
    const html = renderWith({ data: { publishers: [], consumers: [consumer()] } });
    expect(html).toContain("2,210");
    expect(html).toContain("10.0.0.9:51240");
  });

  /*
   * An inactive subscription is a single-active-consumer standby waiting its
   * turn, which is working rather than stuck.
   */
  it("tells a standby consumer apart from a live one", () => {
    const standby = renderWith({
      data: { publishers: [], consumers: [consumer({ active: false })] },
    });
    expect(standby).toContain("待命");

    const live = renderWith({ data: { publishers: [], consumers: [consumer()] } });
    expect(live).not.toContain("待命");
  });
});
