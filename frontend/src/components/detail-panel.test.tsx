import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The detail panel's tab strip drew its active tab twice.
 *
 * shadcn's `line` Tabs variant already renders the active bar as an ::after at
 * `bottom: -5px`, so underlining the trigger as well produces two rules - one
 * flush on the strip's baseline, one floating five pixels below it, with the
 * strip's own border between them. Nothing about the markup looks wrong; it
 * only shows once both are painted.
 *
 * This is the second time a shadcn base style has doubled up with a hand-added
 * one (see panel.test.tsx), which is why it is pinned rather than just fixed.
 */
let render: (node: React.ReactNode) => string;
let DetailPanelHeader: typeof import("./detail-panel").DetailPanelHeader;

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
});

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
];

function triggerClasses(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)]
    .map((match) => match[1] ?? "")
    .filter((classes) => classes.includes("border-b-2"));
}

describe("the detail panel's tab strip", () => {
  it("underlines the active tab exactly once", () => {
    const html = render(
      <DetailPanelHeader title="A group" tabs={TABS} activeTab="overview" />,
    );
    const triggers = triggerClasses(html);
    expect(triggers.length, "expected the tab triggers to be found").toBeGreaterThan(0);

    for (const classes of triggers) {
      // The border is the underline that is kept; the variant's floating bar
      // has to be suppressed, or both paint.
      expect(classes, "the line variant's ::after bar must be hidden").toContain("after:hidden");
    }
  });
});
