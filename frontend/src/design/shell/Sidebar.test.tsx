import { beforeAll, describe, expect, it, vi } from "vitest";
import { Capability } from "@bindings/model/models";

/*
 * A blocked sidebar entry has to explain itself in words.
 *
 * Drivers report a degradation as a translation key, not a sentence - one Go
 * driver's reason has to read in both languages - and the tooltip was showing
 * that key. A Kafka connection to a cluster with no authorizer offered
 * "mq.kafka.degraded.accessControl" as its explanation. RabbitMQ has ten keys
 * that reached the same tooltip the same way.
 */
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "kafka", key: "k1", online: true }),
}));

const capabilities = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/mq/capabilities", () => ({ useCapabilities: () => capabilities.current }));

let render: (element: React.ReactElement) => string;
let Sidebar: typeof import("./Sidebar").Sidebar;

beforeAll(async () => {
  const [server, sidebar, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./Sidebar"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = (node) => server.renderToStaticMarkup(node);
  Sidebar = sidebar.Sidebar;
});

/*
 * A Kafka connection to a cluster with no authorizer: everything it can do,
 * and access control degraded with the reason the driver reports.
 *
 * A closed supported list rather than "anything not degraded", because the ACL
 * entry asks for any one of three capabilities - three families answer that
 * page three ways - and a stub that says yes to all of them is never disabled.
 */
const supported: Capability[] = [
  Capability.CapDestinationList,
  Capability.CapSubscriptionList,
  Capability.CapMessageQuery,
  Capability.CapPublish,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapQuotaList,
];

const state = (degraded: Partial<Record<Capability, string>>) => ({
  has: (capability: Capability) => supported.includes(capability),
  degradedReason: (capability: Capability) => degraded[capability],
  caveat: () => undefined,
  loading: false,
});

describe("the sidebar's reason for a blocked entry", () => {
  it("reads as a sentence, not as a translation key", () => {
    capabilities.current = state({
      [Capability.CapAccessDirectory]: "mq.kafka.degraded.accessControl",
    });

    const html = render(<Sidebar protocol="kafka" active="overview" />);

    expect(html).not.toContain("mq.kafka.degraded.accessControl");
    // The cluster runs no authorizer - that is what the key resolves to, and
    // what an operator needs to read.
    expect(html).toContain("authorizer");
    expect(html).toContain("SECURITY_DISABLED");
  });

  /*
   * The reason has to be reachable, not merely rendered.
   *
   * These entries were `disabled`, and a disabled button receives no pointer
   * events - so the tooltip carrying the reason never appeared, and the whole
   * explanation was computed, translated and invisible. Found by hovering a
   * degraded entry in the running app for five seconds and getting nothing.
   *
   * The two assertions are the fix: the entry still reads as disabled to
   * assistive technology and to the stylesheet, and is not the attribute that
   * suppresses the hover.
   */
  it("leaves a blocked entry hoverable, or nobody ever reads the reason", () => {
    capabilities.current = state({
      [Capability.CapAccessDirectory]: "mq.kafka.degraded.accessControl",
    });

    const html = render(<Sidebar protocol="kafka" active="overview" />);

    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("disabled=\"\"");
  });

  // A reason that is not a key must survive rather than disappear: i18next
  // hands back what it was given when it knows no such key.
  it("passes through a reason that has no translation", () => {
    capabilities.current = state({
      [Capability.CapAccessDirectory]: "something nobody wrote a key for",
    });

    const html = render(<Sidebar protocol="kafka" active="overview" />);
    expect(html).toContain("something nobody wrote a key for");
  });
});
