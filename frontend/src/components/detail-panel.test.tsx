import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The detail panel's tab strip drew its active tab twice.
 *
 * shadcn's `line` Tabs variant already renders the active bar as an ::after at
 * `bottom: -5px`, so underlining the trigger as well produces two rules - one
 * flush on the strip's baseline, one floating five pixels below it, with the
 * strip's own border between them. Nothing about the markup looks wrong; it
 * only shows once both are painted. The variant's bar is the one kept.
 *
 * This is the second time a shadcn base style has doubled up with a hand-added
 * one (see panel.test.tsx), which is why it is pinned rather than just fixed.
 */
let render: (node: React.ReactNode) => string;
let DetailPanelHeader: typeof import("./detail-panel").DetailPanelHeader;
let dismissesSheet: typeof import("./detail-panel").dismissesSheet;
let dismissesOnKey: typeof import("./detail-panel").dismissesOnKey;

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

  const [{ renderToStaticMarkup }, panel] = await Promise.all([
    import("react-dom/server"),
    import("./detail-panel"),
  ]);
  render = renderToStaticMarkup;
  DetailPanelHeader = panel.DetailPanelHeader;
  dismissesSheet = panel.dismissesSheet;
  dismissesOnKey = panel.dismissesOnKey;
});

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
];

function triggerClasses(html: string): string[] {
  return [...html.matchAll(/<button[^>]*data-slot="tabs-trigger"[^>]*>/g)].map(
    (match) => /class="([^"]*)"/.exec(match[0])?.[1] ?? "",
  );
}

describe("the detail panel's tab strip", () => {
  it("underlines the active tab exactly once", () => {
    const html = render(
      <DetailPanelHeader title="A group" tabs={TABS} activeTab="overview" />,
    );
    const triggers = triggerClasses(html);
    expect(triggers.length, "expected the tab triggers to be found").toBeGreaterThan(0);

    for (const classes of triggers) {
      expect(classes, "the line variant's ::after bar must stay").not.toContain("after:hidden");
      expect(classes, "a border underline would paint a second bar").not.toMatch(/\bborder-b(-\d)?\b/);
    }
  });
});

/**
 * Opening a menu from inside the sheet closed the sheet.
 *
 * A modal Radix popup opens on pointerdown and turns off pointer events on
 * body, so the click that follows has nothing under the cursor but the root
 * element. That read as a click on the blank area around the sheet.
 */
describe("closing the sheet on a click outside it", () => {
  // Enough of an element for the checks: it matches no selector.
  class FakeElement {
    isConnected = true;
    closest() {
      return null;
    }
  }

  it("ignores a click that lands on the document root", () => {
    const root = new FakeElement();
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { documentElement: root });
    expect(dismissesSheet(root as unknown as Element, null)).toBe(false);
  });

  it("still closes for a click on the blank area", () => {
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { documentElement: new FakeElement() });
    expect(dismissesSheet(new FakeElement() as unknown as Element, null)).toBe(true);
  });
});

/**
 * Escape closed the sheet along with the menu or dialog open above it. Radix
 * takes the Escape that closes its popup and marks it handled; one press
 * should close one layer.
 */
describe("closing the sheet with Escape", () => {
  beforeEach(() => {
    vi.stubGlobal("Element", class {});
  });

  const key = (over: Partial<KeyboardEvent>) =>
    ({ key: "Escape", defaultPrevented: false, target: null, ...over }) as KeyboardEvent;

  it("leaves the sheet open when a popup above it took the press", () => {
    expect(dismissesOnKey(key({ defaultPrevented: true }))).toBe(false);
  });

  it("closes the sheet on a press nothing else took", () => {
    expect(dismissesOnKey(key({}))).toBe(true);
    expect(dismissesOnKey(key({ key: "Enter" }))).toBe(false);
  });
});
