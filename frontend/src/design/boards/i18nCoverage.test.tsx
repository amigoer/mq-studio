import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every board, rendered in both languages.
 *
 * The boards carry no logic worth a unit test, but they do carry ~900 locale
 * keys, and a key that is used without being defined fails silently: i18next
 * echoes the key back, so the page renders `board.producer.sync` where a label
 * belongs. This is the check that catches that -- and the one that keeps the
 * English bundle from quietly falling back to Chinese.
 *
 * The imports are dynamic because the shell reaches the Wails runtime at module
 * load, which wants a `window` this environment has to install first.
 */

type Board = { name: string; html: string };

let everyBoard: () => Board[];

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

  const [{ renderToStaticMarkup }, protocols, registry, capability, nav, reuse, split] =
    await Promise.all([
      import("react-dom/server"),
      import("@/design/data/protocols"),
      import("@/design/registry"),
      import("@/design/boards/docs/CapabilityMatrix"),
      import("@/design/boards/docs/NavModel"),
      import("@/design/boards/docs/ReuseStrategy"),
      import("@/design/boards/split/SplitCompare"),
    ]);

  const docs = [capability.CapabilityMatrix, nav.NavModel, reuse.ReuseStrategy, split.SplitCompare];

  everyBoard = () => {
    const out: Board[] = [];
    for (const protocol of protocols.PROTOCOL_ORDER) {
      for (const page of protocols.pagesOf(protocol)) {
        out.push({
          name: `${protocol}/${page}`,
          html: renderToStaticMarkup(registry.renderBoard(protocol, page)),
        });
      }
    }
    for (const Doc of docs) out.push({ name: Doc.name, html: renderToStaticMarkup(<Doc />) });
    return out;
  };
});

async function useLanguage(lang: "zh" | "en") {
  const { default: i18n } = await import("@/i18n");
  await i18n.changeLanguage(lang);
}

describe.each(["zh", "en"] as const)("boards in %s", (lang) => {
  it("resolves every key it renders", async () => {
    await useLanguage(lang);
    for (const { name, html } of everyBoard()) {
      // An unresolved key reaches the page as its own dotted name.
      expect(html.match(/\b(board|shell|page|common)\.[a-zA-Z][\w.]*/g), name).toBeNull();
    }
  });
});

describe("boards in en", () => {
  it("leaves no Chinese behind", async () => {
    await useLanguage("en");
    for (const { name, html } of everyBoard()) {
      expect(html.replace(/<[^>]*>/g, "").match(/[一-鿿]+/g), name).toBeNull();
    }
  });
});
