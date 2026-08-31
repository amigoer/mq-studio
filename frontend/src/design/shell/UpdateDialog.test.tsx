import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The update dialog in every phase the Go manager can be in.
 *
 * Same reasoning as the settings card beside it: the markup is not what
 * matters, the mapping is. This is the surface that installs the update, so a
 * phase drawn with the wrong buttons is how a user ends up pressing Download on
 * a download already running -- or, worse, finds no way out of a failure. Both
 * languages are rendered because no board coverage test reaches the shell.
 */

type Render = (state: Partial<UpdateStateShape>, policy?: string) => string;
type UpdateStateShape = {
  phase: string;
  policy: string;
  currentVersion: string;
  latestVersion: string;
  notes: string;
  publishedAt: string;
  releaseURL: string;
  downloaded: number;
  total: number;
  outcome: string;
  checkedAt: string;
  skipped: string;
  location: { kind: string; blocker: string; root: string; target: unknown };
  error: string;
  failedStep: string;
  development: boolean;
};

let render: Render;
let models: typeof import("@bindings/update/models");

// Collected by the stub so a test can assert which button fired what.
const calls: string[] = [];

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

  models = await import("@bindings/update/models");

  const empty: UpdateStateShape = {
    phase: models.Phase.PhaseAvailable,
    policy: models.Policy.PolicyNotify,
    currentVersion: "0.0.3",
    latestVersion: "0.0.4",
    notes: "### 新增\n\n- 一条**新**能力\n",
    publishedAt: "2026-08-30T00:00:00Z",
    releaseURL: "https://github.com/amigoer/mq-studio/releases/tag/v0.0.4",
    downloaded: 0,
    total: -1,
    outcome: "",
    checkedAt: "",
    skipped: "",
    location: {
      kind: models.Kind.KindAppBundle,
      blocker: models.Blocker.BlockerNone,
      root: "/Applications/MQ Studio.app",
      target: {},
    },
    error: "",
    failedStep: "",
    development: false,
  };

  let current: UpdateStateShape = empty;
  let currentPolicy: string = models.Policy.PolicyNotify;

  vi.doMock("@/hooks/useUpdater", () => ({
    useUpdater: () => ({
      state: current,
      available:
        current.latestVersion !== "" && current.latestVersion !== current.skipped
          ? current.latestVersion
          : null,
      busy: [
        models.Phase.PhaseChecking,
        models.Phase.PhaseDownloading,
        models.Phase.PhaseInstalling,
      ].includes(current.phase as never),
      // The dialog only ever renders open; whether it opens is the hook's job.
      dialogOpen: true,
      openDialog: () => calls.push("openDialog"),
      closeDialog: () => calls.push("closeDialog"),
      check: () => {
        calls.push("check");
        return Promise.resolve();
      },
      download: () => {
        calls.push("download");
        return Promise.resolve();
      },
      cancel: () => calls.push("cancel"),
      install: () => {
        calls.push("install");
        return Promise.resolve();
      },
      skip: () => calls.push("skip"),
      openReleases: () => calls.push("openReleases"),
    }),
  }));
  vi.doMock("@/hooks/useSettings", () => ({
    useSettings: () => ({ settings: { updatePolicy: currentPolicy } }),
  }));

  const [{ renderToStaticMarkup }, { Dialog }, { UpdatePanel }] = await Promise.all([
    import("react-dom/server"),
    import("@/components/ui/dialog"),
    import("./UpdateDialog"),
  ]);

  /* The panel rather than the dialog: `DialogContent` renders through a portal
     and server rendering returns nothing for it. The bare `Dialog` root is
     context only -- it supplies the title's id and emits no markup. */
  render = (state, policy) => {
    current = { ...empty, ...state };
    currentPolicy = policy ?? models.Policy.PolicyNotify;
    return renderToStaticMarkup(
      <Dialog open>
        <UpdatePanel />
      </Dialog>,
    );
  };
});

async function useLanguage(lang: "zh" | "en") {
  const { default: i18n } = await import("@/i18n");
  await i18n.changeLanguage(lang);
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("the update dialog", () => {
  it("offers the install beside what changed, with no trip to settings", async () => {
    await useLanguage("zh");
    const html = render({});
    const body = text(html);
    expect(body).toContain("发现新版本 0.0.4");
    expect(body).toContain("当前 0.0.3");
    // The notes are rendered here rather than only in the settings card, and
    // the emphasis is emphasis rather than a pair of asterisks.
    expect(body).toContain("新增");
    expect(html).toMatch(/一条<strong[^>]*>新<\/strong>能力/);
    expect(body).not.toContain("**");
    expect(body).toContain("下载并安装");
    expect(body).toContain("跳过此版本");
    expect(body).toContain("稍后");
  });

  /* The release page works even when whatever the app tries does not, so it is
     on every phase rather than only on the failures. */
  it("always leaves a way out to the release page", async () => {
    await useLanguage("zh");
    for (const phase of ["available", "downloading", "ready", "error"]) {
      expect(text(render({ phase })), phase).toContain("在 GitHub 上查看");
    }
  });

  it("shows progress and only a cancel while downloading", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseDownloading,
      downloaded: 5 * 1024 * 1024,
      total: 20 * 1024 * 1024,
    }));
    expect(body).toContain("正在下载 0.0.4");
    expect(body).toContain("5.0 MB / 20.0 MB");
    expect(body).toContain("取消下载");
    expect(body).not.toContain("下载并安装");
  });

  it("offers a restart once a package is verified", async () => {
    await useLanguage("zh");
    const body = text(render({ phase: models.Phase.PhaseReady }));
    expect(body).toContain("0.0.4 已下载并校验");
    expect(body).toContain("立即重启更新");
    expect(body).not.toContain("下载并安装");
  });

  it("says the auto policy will install on quit", async () => {
    await useLanguage("zh");
    expect(text(render({ phase: models.Phase.PhaseReady }, "auto"))).toContain("退出应用时");
  });

  it("names the step that failed and offers a retry", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseError,
      failedStep: "download",
      error: "downloaded file does not match its published checksum",
    }));
    expect(body).toContain("下载更新失败");
    expect(body).toContain("checksum");
    expect(body).toContain("重试");
  });

  // An install the app cannot perform must not offer a button that would fail.
  it("replaces the download with Releases when it cannot replace itself", async () => {
    await useLanguage("zh");
    const body = text(render({
      location: {
        kind: "managed",
        blocker: models.Blocker.BlockerPackageManager,
        root: "",
        target: {},
      },
    }));
    expect(body).toContain("包管理器");
    expect(body).toContain("打开 Releases");
    expect(body).not.toContain("下载并安装");
  });

  // Nothing to press while the swap is happening, and no stale notes behind it.
  it("draws no actions while installing", async () => {
    await useLanguage("zh");
    const body = text(render({ phase: models.Phase.PhaseInstalling }));
    expect(body).toContain("正在安装");
    expect(body).not.toContain("下载并安装");
    expect(body).not.toContain("立即重启更新");
    expect(body).not.toContain("跳过此版本");
  });
});

describe("the update dialog in English", () => {
  const states: [string, Partial<UpdateStateShape>][] = [
    ["available", {}],
    ["downloading", { phase: "downloading", downloaded: 1, total: 2 }],
    ["ready", { phase: "ready" }],
    ["installing", { phase: "installing" }],
    ["error", { phase: "error", failedStep: "install", error: "boom" }],
    ["blocked", { location: { kind: "managed", blocker: "packageManager", root: "", target: {} } }],
  ];

  it.each(states)("resolves every key and leaves no Chinese in %s", async (_name, state) => {
    await useLanguage("en");
    // English notes as well: the release body is content, not chrome, and
    // leaving it in Chinese would be the only Chinese the sweep ever found.
    const html = render({ notes: "### Added\n\n- One **new** thing\n", ...state });
    expect(html.match(/\b(board|shell|page|common|update|markdown)\.[a-zA-Z][\w.]*/g)).toBeNull();
    expect(text(html).match(/[一-鿿]+/g)).toBeNull();
  });
});
