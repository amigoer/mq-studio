import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every settings dropdown puts its label in a SelectValue.
 *
 * Radix places an item-aligned menu by measuring that node, and it gives up
 * silently when there is none: the menu opens with no position set and lands
 * in the corner of the window, off-screen. The trigger still reports itself
 * open, so the page looks like a dropdown that refuses to drop.
 *
 * The imports are dynamic because the shell reaches the Wails runtime at
 * module load, which wants a `window` this environment has to install first.
 */

type Section = "general" | "fonts" | "message";

let markupOf: (section: Section) => string;

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

  const [{ renderToStaticMarkup }, page, settings, profiles, center, ui] = await Promise.all([
    import("react-dom/server"),
    import("./Settings"),
    import("@/hooks/useSettings"),
    import("@/hooks/useConnectionProfiles"),
    import("@/hooks/useAlertCenter"),
    import("@/components"),
  ]);

  markupOf = (section) =>
    renderToStaticMarkup(
      <ui.ConfirmProvider>
        <settings.SettingsProvider>
          <profiles.ConnectionProfilesProvider>
            <center.AlertCenterProvider>
              <page.Settings
                initialSection={section}
                scale={{ setting: "auto", fontSize: 13, onChange() {} }}
              />
            </center.AlertCenterProvider>
          </profiles.ConnectionProfilesProvider>
        </settings.SettingsProvider>
      </ui.ConfirmProvider>,
    );
});

const triggers = (html: string) =>
  html.match(/<button[^>]*data-slot="select-trigger"[\s\S]*?<\/button>/g) ?? [];

describe.each(["general", "fonts", "message"] as const)("the %s section", (section) => {
  it("gives every dropdown a SelectValue to be measured by", () => {
    const found = triggers(markupOf(section));
    expect(found.length).toBeGreaterThan(0);
    for (const trigger of found) expect(trigger).toContain('data-slot="select-value"');
  });
});
