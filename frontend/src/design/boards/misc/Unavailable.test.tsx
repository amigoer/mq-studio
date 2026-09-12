import { beforeAll, describe, expect, it, vi } from "vitest";
import { Capability } from "@bindings/model/models";

/*
 * A page the connection cannot answer has to say so where the user went.
 *
 * The sidebar used to swallow the click on a degraded entry, so the reason the
 * driver reported was reachable only by hovering it for half a second. What a
 * user saw was a grey row that did nothing, which reads as a broken app rather
 * than as a cluster with a feature switched off. The entry opens now, and this
 * is what it has to land on.
 */
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "kafka", key: "k1", online: true }),
}));

const capabilities = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/mq/capabilities", () => ({ useCapabilities: () => capabilities.current }));

let render: (element: React.ReactElement) => string;
let PageGate: typeof import("./Unavailable").PageGate;

beforeAll(async () => {
  const [server, gate, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./Unavailable"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  render = (node) => server.renderToStaticMarkup(node);
  PageGate = gate.PageGate;
});

/* A closed list rather than "anything not degraded": the ACL page asks for any
   one of five capabilities, and a stub that says yes to all of them is never
   the case under test. */
const state = (supported: Capability[], degraded: Partial<Record<Capability, string>>) => ({
  has: (capability: Capability) => supported.includes(capability),
  degradedReason: (capability: Capability) => degraded[capability],
  caveat: () => undefined,
  loading: false,
});

const board = <div>BOARD</div>;

describe("a page whose capabilities all came back degraded", () => {
  it("opens on the driver's reason, not on the board", () => {
    capabilities.current = state([Capability.CapDestinationList], {
      [Capability.CapAccessDirectory]: "mq.kafka.degraded.accessControl",
    });

    const html = render(
      <PageGate page="acl" labelKey="board.acl.kafka.title">
        {board}
      </PageGate>,
    );

    expect(html).not.toContain("BOARD");
    // The sentence, not the key: a driver reports keys, and a page showing
    // "mq.kafka.degraded.accessControl" explains nothing to anybody.
    expect(html).not.toContain("mq.kafka.degraded.accessControl");
    expect(html).toContain("authorizer");
    expect(html).toContain("SECURITY_DISABLED");
  });

  it("passes a reason that has no translation through as written", () => {
    capabilities.current = state([Capability.CapDestinationList], {
      [Capability.CapAccessDirectory]: "something nobody wrote a key for",
    });

    const html = render(
      <PageGate page="acl" labelKey="board.acl.kafka.title">
        {board}
      </PageGate>,
    );

    expect(html).toContain("something nobody wrote a key for");
  });
});

describe("a page the connection can answer", () => {
  it("draws the board and nothing else", () => {
    capabilities.current = state([Capability.CapAccessDirectory], {});

    const html = render(
      <PageGate page="acl" labelKey="board.acl.kafka.title">
        {board}
      </PageGate>,
    );

    expect(html).toBe("<div>BOARD</div>");
  });
});
