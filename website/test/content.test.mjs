import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { body, githubAnchor, linkIssues, parse, summary } from '../scripts/lib/changelog.mjs';
import { convert, rewriteHref } from '../scripts/lib/docs.mjs';
import { joinCJKBreaks, joinLines } from '../scripts/lib/text.mjs';
import { stableULID } from '../scripts/lib/ulid.mjs';

const CJK = '[\\u2e80-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
const CJK_GAP = new RegExp(`${CJK} +${CJK}`);

const items = (block) => (block?.type === 'list' ? block.items : []);

// Lines 12-20 of CHANGELOG.zh-CN.md: two paragraphs, both wrapped at 80 columns.
const zhIntro = `## [0.0.6] - 2026-09-03

NATS 是第七个驱动，也是这里第一个答案来自四处的家族 —— 协议本身、JetStream、
服务端的 HTTP 监控端点，以及系统账户。连接建立时四层全都会探一遍，每个页面也都
会说明自己读的是哪一层，或者为什么是空的。

同时修掉了三个只有真实 broker 才照得出来的凭据问题：拨号时连接存下来的认证方式
被重置成了「无」、RocketMQ 的全局 AccessKey 被盖到别的家族的连接上、以及
RocketMQ 自己的那对密钥其实从来没有被用来签过名。

### 新增

- 一条要点。
`;

// Lines 44-54 of CHANGELOG.zh-CN.md: a bullet with a second paragraph.
const namespaceBullet = `## [0.0.6] - 2026-09-03

### 新增

- RocketMQ 连接可以填写命名空间，填了之后这个连接做的每一件事都被限定在该命名空间
  内：Topic 和消费组按短名列出，而连接发出的每一个请求带的都是拼接后的全名。留空
  即维持原来的行为：连接看到的是整个集群，包括带前缀的原始名字。(#61, #63)

  这是 RocketMQ 5.x 真正实现的那一套命名空间 —— 客户端侧的那套：\`orders\` 到线上是
  \`ns%orders\`，消费组的重试 Topic 是 \`%RETRY%ns%GID\`。Broker 存的就是一个普通
  Topic，对命名空间一无所知。它不是
  \`namespaceV2\`：那一套发的是两个请求头字段，而 apache/rocketmq 里没有任何代码读它们
  ——这边做了也不会被兑现，也没有任何环境能证明它生效。

### 修复

- 下一节的要点。
`;

test('a release intro keeps its paragraphs whole across wrapped lines', () => {
  const [zh] = parse(zhIntro);
  assert.equal(zh.intro.length, 2);
  assert.match(zh.intro[0], /四处的家族 —— 协议本身、JetStream、服务端的 HTTP 监控端点/);
  assert.match(zh.intro[1], /^同时修掉了三个/);
  assert.doesNotMatch(zh.intro[0], CJK_GAP);
  // An ideograph beside Latin keeps the space; punctuation beside it does not.
  assert.match(zh.intro[1], /连接上、以及 RocketMQ 自己的/);
});

test('an indented block after a blank line is the bullet’s next paragraph', () => {
  const [release] = parse(namespaceBullet);
  assert.equal(release.sections.length, 2);
  const [item] = items(release.sections[0].blocks[0]);
  assert.equal(item.paragraphs.length, 2);
  assert.match(item.paragraphs[0], /留空即维持原来的行为/);
  assert.match(item.paragraphs[0], /\(#61, #63\)$/);
  assert.match(item.paragraphs[1], /到线上是 `ns%orders`，消费组/);
  assert.match(item.paragraphs[1], /读它们——这边做了/);
  assert.doesNotMatch(item.paragraphs[1], CJK_GAP);
  assert.deepEqual(release.sections[0].blocks.map((block) => block.type), ['list']);
});

test('joinLines spaces Latin words and closes up CJK', () => {
  assert.equal(joinLines(['留空', '即维持']), '留空即维持');
  assert.equal(joinLines(['没有上限，', '也就没有']), '没有上限，也就没有');
  assert.equal(joinLines(['sees the cluster', 'whole']), 'sees the cluster whole');
  assert.equal(joinLines(['到线上是', '`ns%orders`，消费组']), '到线上是 `ns%orders`，消费组');
  assert.equal(joinLines(['**架构**', '与桥接']), '**架构**与桥接');
  assert.equal(joinLines(['read', '它们']), 'read 它们');
  assert.equal(joinLines(['通义千问、', 'Kimi']), '通义千问、Kimi');
  assert.equal(joinLines(['an em dash —', 'stays spaced']), 'an em dash — stays spaced');
});

test('issue references link, and code spans stay literal', () => {
  assert.equal(
    linkIssues('答复 (#61, #63)'),
    '答复 ([#61](https://github.com/amigoer/mq-studio/issues/61), [#63](https://github.com/amigoer/mq-studio/issues/63))',
  );
  assert.equal(linkIssues('write `#61` as a literal'), 'write `#61` as a literal');
  assert.equal(linkIssues('&#123; and a/#5'), '&#123; and a/#5');
});

test('a release becomes markdown with its sections as headings', () => {
  const [release] = parse(namespaceBullet);
  const markdown = body(release);
  assert.match(markdown, /^## 新增\n\n- RocketMQ 连接可以填写命名空间/);
  assert.match(markdown, /\n\n {2}这是 RocketMQ 5\.x/);
  assert.match(markdown, /## 修复\n\n- 下一节的要点。\n$/);
  assert.equal(githubAnchor('0.3.0', '2026-10-01'), '030---2026-10-01');
});

const zh = parse(readFileSync(new URL('../../CHANGELOG.zh-CN.md', import.meta.url), 'utf8'));
const en = parse(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'));

test('the real changelogs parse into the same releases and clean text', () => {
  const released = (releases) => releases.filter((release) => !release.unreleased).map((release) => release.slug);
  assert.deepEqual(released(zh), released(en));
  for (const release of [...zh, ...en]) {
    assert.ok(release.intro.length <= 3, `${release.version}: ${release.intro.length} intro paragraphs`);
    for (const section of release.sections) {
      for (const block of section.blocks) {
        if (block.type === 'subheading') assert.ok(block.text.length <= 80, `${release.version}: paragraph-length subheading`);
        const texts = block.type === 'list' ? block.items.flatMap((item) => item.paragraphs) : [block.text];
        for (const text of texts) assert.doesNotMatch(text, CJK_GAP, `${release.version}: ${text.slice(0, 40)}`);
      }
    }
    assert.ok(summary(release).length <= 161, `${release.version}: summary too long`);
  }
  for (const releases of [zh, en]) {
    const first = releases.find((release) => release.version === '0.0.1');
    assert.deepEqual(first.sections[0].blocks.map((block) => block.type), ['subheading', 'list', 'subheading', 'list', 'subheading', 'list']);
  }
});

test('a doc loses its title and translation link, and its links point at the site', () => {
  const source = '# AI 助手\n\n[English](ASSISTANT.md)\n\n按 ⌘J，见 [MCP](MCP.zh-CN.md#设置)、\n[计划](AGENT_IN_APP_PLAN.md) 和\n[README](../README.zh-CN.md)。\n\n```bash\n[x](MCP.md)\n```\n';
  const { title, body: text, description } = convert(source, { chinese: true });
  assert.equal(title, 'AI 助手');
  assert.doesNotMatch(text, /\[English\]/);
  assert.match(text, /\[MCP\]\(\/docs\/mcp\/#设置\)、\[计划\]\(https:\/\/github\.com\/amigoer\/mq-studio\/blob\/main\/docs\/AGENT_IN_APP_PLAN\.md\)/);
  assert.match(text, /\(https:\/\/github\.com\/amigoer\/mq-studio\/blob\/main\/README\.zh-CN\.md\)/);
  assert.match(text, /```bash\n\[x\]\(MCP\.md\)\n```/);
  assert.match(description, /^按 ⌘J，见 MCP、计划 和 README。$/);
  assert.equal(rewriteHref('https://example.com/a.md'), 'https://example.com/a.md');
  assert.equal(rewriteHref('#anchor'), '#anchor');
});

test('Chinese soft breaks close up, and headings, lists and fences stay apart', () => {
  assert.equal(joinCJKBreaks('第一行\n第二行'), '第一行第二行');
  assert.equal(joinCJKBreaks('## 标题\n正文'), '## 标题\n正文');
  assert.equal(joinCJKBreaks('- 列表\n  继续'), '- 列表继续');
  assert.equal(joinCJKBreaks('| 表 |\n| 格 |'), '| 表 |\n| 格 |');
  assert.equal(joinCJKBreaks('```\n代码\n代码\n```'), '```\n代码\n代码\n```');
});

test('an item id is a valid, stable ULID', () => {
  const id = stableULID('release:zh:0.3.0', Date.parse('2026-10-01T00:00:01+08:00'));
  assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  assert.equal(id, stableULID('release:zh:0.3.0', Date.parse('2026-10-01T00:00:01+08:00')));
  assert.notEqual(id, stableULID('release:en:0.3.0', Date.parse('2026-10-01T00:00:01+08:00')));
  assert.match(stableULID('doc:zh:install'), /^0{10}/);
});
