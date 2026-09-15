import { beforeAll, describe, expect, it, vi } from "vitest";
import { MQKind } from "@bindings/model/models";
import type { Connection } from "@/design/data/connections";
import type { BulkRun } from "./useConnectionBulk";

/**
 * The connection list's selection footer, rendered.
 *
 * connectionSelection.test.ts covers which rows an action reaches. What it
 * cannot see is the list's side of a run: the rows still waiting for their turn
 * have to say so in place of the button that would dial them, and the half of
 * the footer that is not showing must be out of the tab order, because both
 * halves stay mounted for the swap between them.
 *
 * The shell initialises i18n on import, so the language is pinned here and the
 * expected labels are read from the bundle rather than written out.
 */

type Props = Parameters<typeof import("./ConnectionsList").ConnectionsList>[0];

let render: (props: Props) => string;
let t: (key: string) => string;

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

  const [{ renderToStaticMarkup }, list, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./ConnectionsList"),
    import("@/i18n"),
  ]);
  await i18n.default.changeLanguage("zh");
  t = (key) => i18n.default.t(key);
  render = (props) => renderToStaticMarkup(<list.ConnectionsList {...props} />);
});

const connections: Connection[] = ["1", "2", "3"].map((key) => ({
  key,
  id: Number(key),
  name: `conn-${key}`,
  protocol: "kafka",
  kind: MQKind.KindKafka,
  protocolLabel: "Kafka",
  address: `10.0.0.${key}:9092`,
  status: "offline",
  lastUsed: "-",
  isDefault: false,
  remark: "",
}));

/** The opening tag of one footer layer. */
function layer(html: string, name: "status" | "bulk"): string {
  const at = html.indexOf(`data-layer="${name}"`);
  return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
}

const count = (html: string, text: string) => html.split(`>${text}</button>`).length - 1;

describe("the connection list during a bulk action", () => {
  it("marks the rows still waiting their turn instead of offering to dial them", () => {
    const run: BulkRun = { action: "connect", keys: ["1", "2", "3"], done: 0, stopping: false };
    const html = render({ connections, bulk: run, pending: { 1: "connecting" } });

    expect(count(html, t("page.connections.bulk.queued"))).toBe(2);
    expect(html).toContain(t("page.connections.connecting"));
  });

  it("shows the bar and takes the footer out of reach while it runs", () => {
    const run: BulkRun = { action: "test", keys: ["2"], done: 0, stopping: false };
    const html = render({ connections, bulk: run });

    expect(html).toContain('class="mqs-footer-swap" data-state="open"');
    expect(layer(html, "status")).toContain('inert=""');
    expect(layer(html, "bulk")).not.toContain('inert=""');
  });
});

describe("the connection list with nothing selected", () => {
  it("keeps the selection bar out of the tab order behind the footer", () => {
    const html = render({ connections });

    expect(html).toContain('class="mqs-footer-swap" data-state="closed"');
    expect(layer(html, "bulk")).toContain('inert=""');
    expect(layer(html, "status")).not.toContain('inert=""');
  });
});
