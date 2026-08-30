import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The update card in every phase the Go manager can be in.
 *
 * What is worth testing here is not the markup but the mapping: each phase has
 * one headline and one set of actions, and getting that wrong is how a user
 * ends up with a Download button while a download is already running, or with
 * no way out of a failure. Both languages are rendered, because the card is
 * the one settings surface the board coverage test does not reach.
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
// The generated enums themselves, so the cases stay tied to the Go constants
// rather than to string literals that could drift from them.
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
    phase: models.Phase.PhaseIdle,
    policy: models.Policy.PolicyNotify,
    currentVersion: "0.1.3",
    latestVersion: "",
    notes: "",
    publishedAt: "",
    releaseURL: "",
    downloaded: 0,
    total: -1,
    outcome: "",
    checkedAt: "",
    skipped: "",
    location: { kind: models.Kind.KindAppBundle, blocker: models.Blocker.BlockerNone, root: "/Applications/MQ Studio.app", target: {} },
    error: "",
    failedStep: "",
    development: false,
  };

  let current: UpdateStateShape = empty;
  let currentPolicy: string = models.Policy.PolicyNotify;

  vi.doMock("@/hooks/useUpdater", () => ({
    useUpdater: () => ({
      state: current,
      available: current.latestVersion !== "" && current.latestVersion !== current.skipped
        ? current.latestVersion
        : null,
      busy: [models.Phase.PhaseChecking, models.Phase.PhaseDownloading, models.Phase.PhaseInstalling]
        .includes(current.phase as never),
      check: () => { calls.push("check"); return Promise.resolve(); },
      download: () => { calls.push("download"); return Promise.resolve(); },
      cancel: () => calls.push("cancel"),
      install: () => { calls.push("install"); return Promise.resolve(); },
      skip: () => calls.push("skip"),
      openReleases: () => calls.push("openReleases"),
    }),
  }));
  vi.doMock("@/hooks/useSettings", () => ({
    useSettings: () => ({ settings: { updatePolicy: currentPolicy } }),
  }));

  const [{ renderToStaticMarkup }, { UpdateCard }] = await Promise.all([
    import("react-dom/server"),
    import("./UpdateCard"),
  ]);

  render = (state, policy) => {
    current = { ...empty, ...state };
    currentPolicy = policy ?? models.Policy.PolicyNotify;
    return renderToStaticMarkup(<UpdateCard />);
  };
});

async function useLanguage(lang: "zh" | "en") {
  const { default: i18n } = await import("@/i18n");
  await i18n.changeLanguage(lang);
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const available = { phase: "available", latestVersion: "0.2.0", publishedAt: "2026-08-30T00:00:00Z" };

describe("the update card", () => {
  it("offers a check and says when it last ran, with nothing pending", async () => {
    await useLanguage("zh");
    const body = text(render({ checkedAt: "2026-08-30T09:00:00Z" }));
    expect(body).toContain("已是最新版本 0.1.3");
    expect(body).toContain("上次检查");
    expect(body).toContain("检查更新");
    expect(body).not.toContain("下载");
  });

  it("says so when it has never checked", async () => {
    await useLanguage("zh");
    expect(text(render({}))).toContain("尚未检查过");
  });

  it("offers download and skip for a release, and shows what changed", async () => {
    await useLanguage("zh");
    const body = text(render({ ...available, notes: "## 新增\n- 自动更新\n- 更好的提示" }));
    expect(body).toContain("发现新版本 0.2.0");
    expect(body).toContain("当前 0.1.3");
    expect(body).toContain("下载并安装");
    expect(body).toContain("跳过此版本");
    // The notes are rendered, headings and bullets alike.
    expect(body).toContain("新增");
    expect(body).toContain("自动更新");
  });

  it("shows progress and only a cancel while downloading", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseDownloading,
      latestVersion: "0.2.0",
      downloaded: 5 * 1024 * 1024,
      total: 20 * 1024 * 1024,
    }));
    expect(body).toContain("正在下载 0.2.0");
    expect(body).toContain("5.0 MB / 20.0 MB");
    expect(body).toContain("取消下载");
    expect(body).not.toContain("下载并安装");
  });

  it("draws a full bar and a byte count when the length is unknown", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseDownloading,
      latestVersion: "0.2.0",
      downloaded: 3 * 1024 * 1024,
      total: -1,
    }));
    expect(body).toContain("3.0 MB");
    expect(body).not.toContain("/");
  });

  it("offers a restart once a package is verified", async () => {
    await useLanguage("zh");
    const body = text(render({ phase: models.Phase.PhaseReady, latestVersion: "0.2.0" }));
    expect(body).toContain("0.2.0 已下载并校验");
    expect(body).toContain("重启应用即可完成更新");
    expect(body).toContain("立即重启更新");
  });

  // Under the auto policy the swap happens at quit, and saying so is the whole
  // difference between the two rungs.
  it("says the auto policy will install on quit", async () => {
    await useLanguage("zh");
    const body = text(render({ phase: models.Phase.PhaseReady, latestVersion: "0.2.0" }, "auto"));
    expect(body).toContain("退出应用时");
  });

  it("names the step that failed and always leaves a way out", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseError,
      failedStep: "download",
      latestVersion: "0.2.0",
      error: "downloaded file does not match its published checksum",
    }));
    expect(body).toContain("下载更新失败");
    expect(body).toContain("checksum");
    // Releases works even when whatever the app tried does not.
    expect(body).toContain("打开 Releases");
    expect(body).toContain("重试");
  });

  // A release with no SHA256SUMS.txt is refused rather than trusted, and the
  // card has to say so and send the reader somewhere useful.
  it("offers Releases when a release publishes no checksums", async () => {
    await useLanguage("zh");
    const body = text(render({
      phase: models.Phase.PhaseError,
      failedStep: "download",
      latestVersion: "0.2.0",
      error: "release 0.2.0 publishes no SHA256SUMS.txt",
    }));
    expect(body).toContain("SHA256SUMS.txt");
    expect(body).toContain("打开 Releases");
  });

  // An install the app cannot perform must not offer a button that would fail;
  // it sends the user to Releases and explains why.
  it("replaces the download with Releases when it cannot replace itself", async () => {
    await useLanguage("zh");
    const body = text(render({
      ...available,
      location: {
        kind: "managed",
        blocker: models.Blocker.BlockerPackageManager,
        root: "",
        target: {},
      },
    }));
    expect(body).toContain("打开 Releases");
    expect(body).not.toContain("下载并安装");
    expect(body).toContain("包管理器");
  });

  it("explains a read-only install location", async () => {
    await useLanguage("zh");
    const body = text(render({
      ...available,
      location: { kind: "appBundle", blocker: models.Blocker.BlockerReadOnly, root: "/x/MQ Studio.app", target: {} },
    }));
    expect(body).toContain("不可写");
  });
});

describe("the update card in English", () => {
  const states: [string, Partial<UpdateStateShape>][] = [
    ["idle", { checkedAt: "2026-08-30T09:00:00Z" }],
    ["available", available],
    ["downloading", { phase: "downloading", latestVersion: "0.2.0", downloaded: 1, total: 2 }],
    ["ready", { phase: "ready", latestVersion: "0.2.0" }],
    ["installing", { phase: "installing" }],
    ["error", { phase: "error", failedStep: "install", error: "boom" }],
    ["blocked", { ...available, location: { kind: "managed", blocker: "packageManager", root: "", target: {} } }],
  ];

  it.each(states)("resolves every key and leaves no Chinese in %s", async (_name, state) => {
    await useLanguage("en");
    const html = render(state);
    expect(html.match(/\b(board|shell|page|common|update)\.[a-zA-Z][\w.]*/g)).toBeNull();
    expect(text(html).match(/[一-鿿]+/g)).toBeNull();
  });
});

describe("the update card in a development build", () => {
  it("says what it is instead of claiming to be up to date", async () => {
    await useLanguage("zh");
    const body = text(render({ development: true, currentVersion: "dev" }));
    expect(body).toContain("开发构建");
    expect(body).not.toContain("已是最新版本");
  });
});
