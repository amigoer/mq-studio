import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The assistant section in both languages, with services and without.
 *
 * The board coverage test never reaches the settings page, and this section
 * reads its data through a hook whose effect static rendering never runs, so
 * the hook is stood in for with what Go would have answered.
 *
 * The imports are dynamic because the shell reaches the Wails runtime at
 * module load, which wants a `window` this environment has to install first.
 */

type View = {
  providers: {
    id: string;
    name: string;
    kind: string;
    baseURL: string;
    model: string;
    proxy: string;
    fallback: boolean;
    apiKeyConfigured: boolean;
  }[];
  default: string;
  effort: string;
  writes: string;
  bodyBytes: number;
  bodyLimits: number[];
  retention: number;
  retentions: number[];
};

const configured: View = {
  providers: [
    {
      id: "a1",
      name: "Anthropic",
      kind: "anthropic",
      baseURL: "",
      model: "claude-opus-5-5",
      proxy: "",
      fallback: true,
      apiKeyConfigured: true,
    },
    {
      id: "o1",
      name: "Ollama",
      kind: "openai",
      baseURL: "http://127.0.0.1:11434/v1",
      model: "qwen3:14b",
      proxy: "",
      fallback: false,
      apiKeyConfigured: false,
    },
  ],
  default: "",
  effort: "medium",
  writes: "approve",
  bodyBytes: 2048,
  bodyLimits: [0, 2048, 8192, 32768],
  retention: 30,
  retentions: [0, 7, 30, 90],
};

let markupOf: (view: View) => string;
let useLanguage: (lang: "zh" | "en") => Promise<void>;

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

  let current: View = configured;
  vi.doMock("@/hooks/useAgentSettings", () => ({
    useAgentSettings: () => ({
      view: current,
      error: null,
      saveProvider: () => Promise.resolve(current),
      deleteProvider: () => Promise.resolve(current),
      savePreferences: () => Promise.resolve(current),
    }),
  }));

  const [{ renderToStaticMarkup }, panel, ui, i18n] = await Promise.all([
    import("react-dom/server"),
    import("./AssistantPanel"),
    import("@/components"),
    import("@/i18n"),
  ]);
  markupOf = (view) => {
    current = view;
    return renderToStaticMarkup(
      <ui.ConfirmProvider>
        <panel.AssistantPanel />
      </ui.ConfirmProvider>,
    );
  };
  useLanguage = async (lang) => {
    await i18n.default.changeLanguage(lang);
  };
});

const empty: View = { ...configured, providers: [] };

describe.each(["zh", "en"] as const)("the assistant section in %s", (lang) => {
  it.each([
    ["with services", configured],
    ["with none", empty],
  ] as const)("resolves every key it renders %s", async (_, view) => {
    await useLanguage(lang);
    const html = markupOf(view);
    expect(html.match(/\bpage\.[a-zA-Z][\w.]*/g)).toBeNull();
  });
});

describe("the assistant section", () => {
  it("leaves no Chinese behind in English", async () => {
    await useLanguage("en");
    for (const view of [configured, empty]) {
      expect(markupOf(view).replace(/<[^>]*>/g, "").match(/[一-鿿]+/g)).toBeNull();
    }
  });

  it("lists each service with its model and where it is reached", async () => {
    await useLanguage("en");
    const html = markupOf(configured);
    for (const text of ["claude-opus-5-5", "api.anthropic.com", "qwen3:14b", "127.0.0.1:11434/v1"]) {
      expect(html).toContain(text);
    }
  });

  // With nothing chosen Go starts on the first service, and the page has to
  // say so rather than show no default at all.
  it("marks the first service default when none is chosen", async () => {
    await useLanguage("en");
    const html = markupOf(configured);
    expect(html.indexOf("Default</span>")).toBeGreaterThan(html.indexOf("Anthropic"));
    expect(html.indexOf("Default</span>")).toBeLessThan(html.indexOf("Ollama"));
  });

  it("offers how long conversations are kept, and a way to clear them", async () => {
    await useLanguage("en");
    const html = markupOf(configured);
    expect(html).toContain("30 days");
    expect(html).toContain("Clear conversations");
  });

  it("offers the way in when there is no service", async () => {
    await useLanguage("en");
    expect(markupOf(empty)).toContain("Add a model service");
  });

  it("gives every dropdown a SelectValue to be measured by", async () => {
    await useLanguage("en");
    const triggers = markupOf(configured).match(/<button[^>]*data-slot="select-trigger"[\s\S]*?<\/button>/g) ?? [];
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) expect(trigger).toContain('data-slot="select-value"');
  });
});
