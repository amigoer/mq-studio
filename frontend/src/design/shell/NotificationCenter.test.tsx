import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The popover's rows, rendered from real records.
 *
 * The bell itself cannot be server-rendered -- Radix puts the content in a
 * portal that only exists while it is open -- so this covers the half that
 * carries the wiring: a record in, the headline, figure and meta line out, in
 * both languages, with a recovered row reading differently from a live one.
 */

type Render = (props: Record<string, unknown>) => string;

/** The muted second line of each row, which is what carries threshold and time. */
function metaLines(html: string): string[] {
  return [...html.matchAll(/<span class="mt-px block[^"]*">([^<]*)<\/span>/g)].map(
    (match) => match[1] ?? "",
  );
}

let renderRows: Render;
let record: (over?: Record<string, unknown>) => Record<string, unknown>;

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

  const [{ createElement }, { renderToStaticMarkup }, center] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("./NotificationCenter"),
  ]);

  const NOW = Date.now();
  record = (over = {}) => ({
    id: "7:group-lag-order-settle",
    connectionId: 7,
    ruleKey: "groupLag",
    severity: "warn",
    params: { group: "order-settle", lag: 12043, threshold: 10000 },
    firstSeen: NOW - 18 * 60_000,
    lastSeen: NOW,
    read: false,
    ...over,
  });

  renderRows = (props) =>
    renderToStaticMarkup(
      // Rendered as an element, not called: it uses hooks.
      createElement(center.AlertGroupRows as never, {
        group: { connectionId: 7, name: "rocketmq-order", kind: undefined, records: [] },
        timezone: "local",
        onSelect: () => {},
        ...props,
      }),
    );
});

async function useLanguage(lang: "zh" | "en") {
  const { default: i18n } = await import("@/i18n");
  await i18n.changeLanguage(lang);
}

describe("notification rows", () => {
  it("draws a firing alert with its subject, figure and threshold", async () => {
    await useLanguage("zh");
    const html = renderRows({
      group: {
        connectionId: 7,
        name: "rocketmq-order",
        kind: undefined,
        records: [record()],
      },
    });

    expect(html).toContain("rocketmq-order");
    expect(html).toContain("order-settle 堆积超阈值");
    // The measurement is set beside the headline in mono, grouped.
    expect(html).toContain("12,043");
    expect(html).toContain("阈值 10,000");
    expect(html).toContain("持续 18 分钟");
    // A live row keeps its chevron.
    expect(html).toContain("lucide-chevron-right");
  });

  it("draws a recovered alert as a window, with no chevron", async () => {
    await useLanguage("zh");
    const now = Date.now();
    const html = renderRows({
      group: {
        connectionId: 7,
        name: "rocketmq-order",
        kind: undefined,
        records: [record({ firstSeen: now - 5 * 60_000, resolvedAt: now, read: true })],
      },
    });

    expect(html).toContain("已恢复");
    expect(html).not.toContain("lucide-chevron-right");
    // A recovery reports the window it occupied and nothing else: no
    // threshold, no running duration. ("阈值" is in the headline regardless.)
    expect(metaLines(html)).toHaveLength(1);
    expect(metaLines(html)[0]).toMatch(/^\d{2}:\d{2} - \d{2}:\d{2}$/);
  });

  it("resolves every rule in English, leaving no Chinese and no raw key", async () => {
    await useLanguage("en");
    const rules = [
      { ruleKey: "brokerOffline", params: { broker: "broker-a", address: "127.0.0.1:10911" } },
      { ruleKey: "groupOffline", params: { group: "order-settle", lag: 12043 } },
      { ruleKey: "groupLag", params: { group: "order-settle", lag: 12043, threshold: 10000 } },
      { ruleKey: "diskUsage", params: { broker: "broker-b", usage: 87, threshold: 85 } },
      { ruleKey: "dlqGrowth", params: { group: "order-settle", count: 8 } },
    ];
    const html = renderRows({
      group: {
        connectionId: 7,
        name: "rocketmq-order",
        kind: undefined,
        records: rules.map((rule, index) => record({ ...rule, id: `7:r${index}` })),
      },
    });

    expect(html.replace(/<[^>]*>/g, "").match(/[一-鿿]+/g)).toBeNull();
    expect(html.match(/\b(alerts|shell)\.[a-zA-Z][\w.]*/g)).toBeNull();
    expect(html).toContain("broker-a is offline");
    expect(html).toContain("broker-b disk at 87%");
    expect(html).toContain("Threshold 10,000");
  });
});
