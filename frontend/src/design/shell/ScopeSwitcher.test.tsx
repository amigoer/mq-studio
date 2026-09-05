import { beforeAll, describe, expect, it, vi } from "vitest";
import { Capability } from "@bindings/model/models";

/*
 * The namespace switcher, which re-points a whole connection.
 *
 * What has to hold here is that it never appears on a family with no such
 * scope: a Kafka tab offering a namespace switch would be offering something
 * the driver would refuse. What the popover lists once it is open is the
 * helper's business, and is covered in scopeOptions.test.ts.
 */
vi.mock("@/mq/ConnectionScope", () => ({
  useConnectionScope: () => ({ id: 1, kind: "rocketmq", key: "1", online: true }),
}));

const capabilities = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/mq/capabilities", () => ({ useCapabilities: () => capabilities.current }));

vi.mock("@/api/connection", () => ({ listScopes: () => Promise.resolve([]) }));

let render: (element: React.ReactElement) => string;
let ScopeSwitcher: typeof import("./ScopeSwitcher").ScopeSwitcher;

beforeAll(async () => {
  const [server, module, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./ScopeSwitcher"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("en");
  render = (node) => server.renderToStaticMarkup(node);
  ScopeSwitcher = module.ScopeSwitcher;
});

const state = (supported: Capability[]) => ({
  has: (capability: Capability) => supported.includes(capability),
  degradedReason: () => undefined,
  caveat: () => undefined,
  loading: false,
});

describe("the namespace switcher", () => {
  it("draws nothing where the connection carries no such scope", () => {
    capabilities.current = state([Capability.CapDestinationList]);
    expect(render(<ScopeSwitcher scope="" onSwitch={() => {}} />)).toBe("");
  });

  it("names the namespace the connection is scoped to", () => {
    capabilities.current = state([Capability.CapConnectionScope]);
    expect(render(<ScopeSwitcher scope="MQ_INST_1" onSwitch={() => {}} />)).toContain("MQ_INST_1");
  });

  // Unscoped is a state, not a blank: the connection is reading every
  // namespace on the cluster, and the button has to say so.
  it("says the connection is unscoped rather than showing nothing", () => {
    capabilities.current = state([Capability.CapConnectionScope]);
    expect(render(<ScopeSwitcher scope="" onSwitch={() => {}} />)).toContain("All namespaces");
  });
});
