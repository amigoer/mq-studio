import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Panel claims to be "the Card without its stack layout", and that claim is
 * easy to break silently.
 *
 * shadcn's Card is `flex flex-col`. Overriding only the display leaves the
 * direction behind, because tailwind-merge treats those as separate groups -
 * so a Panel looks fine until something turns flex back on, and then every
 * child stacks vertically. It reached the producer board that way: three
 * controls meant to sit in a row appeared stacked and centred.
 */
let render: (node: React.ReactNode) => string;
let Panel: typeof import("./panel").Panel;

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
    import("./panel"),
  ]);
  render = renderToStaticMarkup;
  Panel = panel.Panel;
});

/** The class attribute of the outermost element in a rendered fragment. */
function classesOf(html: string): string[] {
  return /class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/) ?? [];
}

describe("Panel", () => {
  it("does not inherit the Card's column direction", () => {
    const classes = classesOf(render(<Panel />));
    expect(classes, "Card's flex-col must not survive").not.toContain("flex-col");
  });

  it("lays a row out horizontally when a caller turns flex on", () => {
    // What the producer board's target row does: one label, then controls.
    const html = render(
      <Panel className="flex items-center gap-2.5">
        <span>label</span>
        <span>control</span>
      </Panel>,
    );
    const classes = classesOf(html);
    expect(classes).toContain("flex");
    expect(classes, "a row must not be turned into a column").not.toContain("flex-col");
  });

  it("still lets a caller ask for a column deliberately", () => {
    const classes = classesOf(render(<Panel className="flex flex-col" />));
    expect(classes).toContain("flex-col");
  });
});
