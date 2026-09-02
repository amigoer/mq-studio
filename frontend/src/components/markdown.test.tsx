import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The release-notes renderer, against a real published release body.
 *
 * The fixture is lifted verbatim from the 0.0.3 release -- CRLF included,
 * because that is what the GitHub API returns and splitting on "\n" alone is
 * what used to leave a "\r" on the end of every line. What is worth asserting
 * is not the markup but that no marker reaches the reader: an unrendered `**`
 * or `](` is the whole of issue #47.
 */

let Markdown: typeof import("./markdown").Markdown;
let parseBlocks: typeof import("./markdown").parseBlocks;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

const RELEASE_BODY = [
  "> [!IMPORTANT]",
  "> **macOS —— 此版本尚未使用 Apple 开发者证书签名。**",
  "> 将 MQ Studio 拖入 Applications 后，双击磁盘映像里的「首次运行」。",
  "> 详见 [安装说明](https://github.com/amigoer/mq-studio/blob/main/docs/INSTALL.zh-CN.md)。",
  "",
  "[English](https://github.com/amigoer/mq-studio/blob/main/CHANGELOG.md#003---2026-08-31)",
  "",
  "Kafka 支持，直接走 Kafka 自己的协议，而不是旁边另接一个管理 API。Topic、消费组、",
  "消息与访问控制都已接入；Kafka 本身不报的数字一律留白，不做填充。",
  "",
  "### 新增",
  "",
  "**Kafka 3.x 与 4.x**",
  "",
  "- 通过 Kafka 自身协议连接集群，支持 SASL/PLAIN、SASL/SCRAM 与 TLS。SCRAM 摘要",
  "  单独作为一个字段：SHA-256 与 SHA-512 在 broker 上是两套独立凭据，同一个用户在",
  "  另一种摘要下会认证失败，把这种失败报成「密码错误」是在撒谎。",
  "- 概览、Topic、消费组、消息、发送台、集群、访问控制、配额与告警。",
  "",
  "### 说明",
  "",
  "- 有三样东西 Kafka 不报，本次也不编。没有死信页：Kafka 没有 broker 侧死信队列，",
  "  `.DLT` 后缀是 Spring Kafka 的约定而不是 Kafka 的。",
  "",
  "---",
  "",
  "**完整变更**：https://github.com/amigoer/mq-studio/compare/v0.0.2...v0.0.3",
  "",
].join("\r\n");

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

  const [server, module] = await Promise.all([import("react-dom/server"), import("./markdown")]);
  renderToStaticMarkup = server.renderToStaticMarkup;
  Markdown = module.Markdown;
  parseBlocks = module.parseBlocks;
});

async function useLanguage(lang: "zh" | "en") {
  const { default: i18n } = await import("@/i18n");
  await i18n.changeLanguage(lang);
}

const render = (source: string) => renderToStaticMarkup(<Markdown source={source} />);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("parsing a published release body", () => {
  it("reads the banner as an alert rather than a quoted line", () => {
    const first = parseBlocks(RELEASE_BODY)[0];
    expect(first).toMatchObject({ kind: "quote", alert: "important" });
    // The `[!IMPORTANT]` marker line is the label, not part of the body.
    expect((first as { text: string }).text).not.toContain("[!");
  });

  it("folds a wrapped bullet back into the item it belongs to", () => {
    const lists = parseBlocks(RELEASE_BODY).filter((block) => block.kind === "list");
    const added = lists[0] as { items: { text: string }[] };
    // Three source lines, one bullet: the two indented lines are continuations.
    expect(added.items).toHaveLength(2);
    expect(added.items[0]?.text).toContain("SCRAM 摘要单独作为一个字段");
    expect(added.items[0]?.text).toContain("是在撒谎");
  });

  /* A newline between two Chinese characters is a space in HTML, and a space
     in the middle of a Chinese sentence is a typo. */
  it("joins wrapped Chinese without inserting a space", () => {
    const blocks = parseBlocks(RELEASE_BODY);
    const intro = blocks.find(
      (block) => block.kind === "paragraph" && block.text.startsWith("Kafka 支持"),
    ) as { text: string };
    expect(intro.text).toContain("Topic、消费组、消息与访问控制");
    expect(intro.text).not.toContain("消费组、 消息");
  });

  it("keeps the Latin space a wrapped English line needs", () => {
    const [block] = parseBlocks("the quick brown\nfox jumps");
    expect((block as { text: string }).text).toBe("the quick brown fox jumps");
  });

  it("recognises the rule and the headings", () => {
    const blocks = parseBlocks(RELEASE_BODY);
    expect(blocks.some((block) => block.kind === "rule")).toBe(true);
    expect(
      blocks.filter((block) => block.kind === "heading").map((block) => (block as { text: string }).text),
    ).toEqual(["新增", "说明"]);
  });
});

describe("rendering a published release body", () => {
  it("leaves no markup for the reader to decode", async () => {
    await useLanguage("zh");
    const body = text(render(RELEASE_BODY));
    for (const marker of ["**", "](", "[!", "\r", "###", "```"]) {
      expect(body, marker).not.toContain(marker);
    }
    // The rule is drawn, not spelled.
    expect(body).not.toMatch(/(^|\s)---(\s|$)/);
  });

  it("names the alert in the reader's language", async () => {
    await useLanguage("zh");
    expect(text(render(RELEASE_BODY))).toContain("重要");
    await useLanguage("en");
    expect(text(render(RELEASE_BODY))).toContain("Important");
  });

  it("keeps a link's target and its text", async () => {
    await useLanguage("zh");
    const html = render(RELEASE_BODY);
    expect(html).toContain('href="https://github.com/amigoer/mq-studio/blob/main/docs/INSTALL.zh-CN.md"');
    expect(text(html)).toContain("安装说明");
  });

  it("links a bare URL and stops it at the Chinese around it", async () => {
    await useLanguage("zh");
    const html = render("见 https://example.com/a 的说明");
    expect(html).toContain('href="https://example.com/a"');
    expect(text(html)).toContain("的说明");
    expect(html).not.toContain('href="https://example.com/a的说明"');
  });

  /* The banner wraps immediately after a `**`, and the marker is not what the
     reader sees at the join -- the ideograph before it is. */
  it("looks past emphasis markers when joining wrapped Chinese", async () => {
    await useLanguage("zh");
    // On the markup, not on `text()`: that helper turns every tag into a space,
    // and the join being asserted here sits right against a closing one.
    expect(render(RELEASE_BODY)).toContain("证书签名。</strong>将 MQ Studio");
  });

  it("draws inline code as code", async () => {
    await useLanguage("zh");
    const html = render(RELEASE_BODY);
    expect(html).toContain("<code");
    expect(html).toMatch(/<code[^>]*>\.DLT<\/code>/);
  });

  it("emits one list item per bullet", async () => {
    await useLanguage("zh");
    const html = render(RELEASE_BODY);
    expect(html.match(/<li/g)).toHaveLength(3);
  });

  /* A bullet names the issues it answers as a bare `(#61, #63)`, which
     scripts/release-notes.mjs expands before the body ever reaches here. */
  it("links the issue references the release notes expanded", async () => {
    await useLanguage("zh");
    const issue = "https://github.com/amigoer/mq-studio/issues";
    const html = render(
      `- RocketMQ 连接可以填写命名空间。([#61](${issue}/61), [#63](${issue}/63))`,
    );
    expect(html).toContain(`href="${issue}/61"`);
    expect(html).toContain(`href="${issue}/63"`);
    // On the markup, not on `text()`: the punctuation between two adjacent
    // links is the part that could break, and that helper turns every tag into
    // a space, which is exactly the gap being asserted against.
    expect(html).toMatch(/。\(<a [^>]*>#61<\/a>, <a [^>]*>#63<\/a>\)/);
  });
});

describe("refusing what it should not render", () => {
  it("drops a link scheme it will not open, keeping the text", async () => {
    await useLanguage("zh");
    // eslint-disable-next-line no-script-url
    const html = render("[点我](javascript:alert(1)) 和 [好的](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(text(html)).toContain("点我");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders embedded HTML as the text it is", async () => {
    await useLanguage("zh");
    const html = render('<img src=x onerror="alert(1)"> <b>hi</b>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(text(html)).toContain("hi");
  });

  /* Tables are the known gap. Degrading to text is acceptable; emitting broken
     markup, or the pipes-and-dashes of a half-parsed table, is not. */
  it("degrades a table to text instead of breaking", async () => {
    await useLanguage("zh");
    const html = render("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).not.toContain("<table");
    expect(text(html)).toContain("| a | b |");
  });

  it("renders nothing at all for empty notes", async () => {
    await useLanguage("zh");
    expect(render("")).toBe("");
    expect(render("   \n\n  ")).toBe("");
  });
});
