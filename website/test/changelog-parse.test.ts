import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinLines, parse, type Block } from '../src/lib/changelog-parse.ts';

// The same class the CI verify step greps the built pages with.
const CJK = '[\\u2e80-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
const CJK_GAP = new RegExp(`${CJK} +${CJK}`);

const items = (block: Block | undefined) => (block?.type === 'list' ? block.items : []);

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

// Lines 12-23 of CHANGELOG.md.
const enIntro = `## [0.0.6] - 2026-09-03

NATS is the seventh driver, and the first family here whose answers come from
four separate places — the protocol itself, JetStream, the server's HTTP
monitoring endpoint, and the system account. All four are probed when a
connection opens, and every page says which of them it is reading, or why it
is empty.

Alongside it, three credential bugs that only a real broker could show: a
connection was dialled with its stored authentication mechanism reset to none,
RocketMQ's global access key was stamped onto connections of other families,
and RocketMQ's own key pair was never signed with at all.

### Added

- One bullet.
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

  const [en] = parse(enIntro);
  assert.equal(en.intro.length, 2);
  assert.match(en.intro[0], /come from four separate places — the protocol itself/);
  assert.match(en.intro[1], /^Alongside it, three credential bugs/);
});

test('an indented block after a blank line is the bullet’s next paragraph', () => {
  const [release] = parse(namespaceBullet);
  assert.equal(release.sections.length, 2);
  const [item] = items(release.sections[0].blocks[0]);
  assert.equal(item.paragraphs.length, 2);
  assert.match(item.paragraphs[0], /留空即维持原来的行为/);
  assert.match(item.paragraphs[0], /\(#61, #63\)$/);
  assert.match(item.paragraphs[1], /^这是 RocketMQ 5\.x 真正实现的那一套命名空间/);
  // A CJK-to-code boundary keeps the space the file itself writes there.
  assert.match(item.paragraphs[1], /到线上是 `ns%orders`，消费组/);
  // A wrapped line that starts with an em dash joins flush.
  assert.match(item.paragraphs[1], /读它们——这边做了/);
  assert.doesNotMatch(item.paragraphs[1], CJK_GAP);
  // Nothing leaked into the section as prose or a subheading.
  assert.deepEqual(
    release.sections[0].blocks.map((block) => block.type),
    ['list'],
  );
});

test('joinLines spaces Latin words and closes up CJK', () => {
  assert.equal(joinLines(['留空', '即维持']), '留空即维持');
  assert.equal(joinLines(['没有上限，', '也就没有']), '没有上限，也就没有');
  assert.equal(joinLines(['sees the cluster', 'whole']), 'sees the cluster whole');
  assert.equal(joinLines(['到线上是', '`ns%orders`，消费组']), '到线上是 `ns%orders`，消费组');
  assert.equal(joinLines(['**架构**', '与桥接']), '**架构**与桥接');
  assert.equal(joinLines(['read', '它们']), 'read 它们');
});

const zh = parse(readFileSync(new URL('../../CHANGELOG.zh-CN.md', import.meta.url), 'utf8'));
const en = parse(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'));

const texts = (blocks: Block[]) =>
  blocks.flatMap((block) =>
    block.type === 'list' ? block.items.flatMap((item) => item.paragraphs) : [block.text],
  );

test('bold lines in the real 0.0.1 entry stay subheadings above their lists', () => {
  for (const releases of [zh, en]) {
    const first = releases.find((release) => release.version === '0.0.1');
    assert.ok(first);
    const shape = first.sections[0].blocks.map((block) => block.type);
    assert.deepEqual(shape, ['subheading', 'list', 'subheading', 'list', 'subheading', 'list']);
  }
});

test('the real changelogs parse into the same routes and clean text', () => {
  assert.deepEqual(
    zh.map((release) => release.id),
    en.map((release) => release.id),
  );
  for (const release of [...zh, ...en]) {
    assert.ok(release.intro.length <= 3, `${release.version}: ${release.intro.length} intro paragraphs`);
    for (const section of release.sections) {
      for (const block of section.blocks) {
        if (block.type === 'subheading') {
          assert.ok(block.text.length <= 80, `${release.version}: paragraph-length subheading`);
        }
      }
      for (const text of [...release.intro, ...texts(section.blocks)]) {
        assert.doesNotMatch(text, CJK_GAP, `${release.version}: ${text.slice(0, 40)}`);
      }
    }
  }
  // The bullet that motivated the second-paragraph rule, in both languages.
  // Looked up by version: an unreleased section, once it has content, is the
  // first entry in the file.
  const bullet = (releases: typeof zh) => {
    const release = releases.find((candidate) => candidate.version === '0.0.6');
    return items(release?.sections[0]?.blocks.at(-1)).at(-1)?.paragraphs ?? [];
  };
  assert.equal(bullet(zh).length, 2);
  assert.equal(bullet(en).length, 2);
  assert.match(bullet(en)[1], /^This is the namespace RocketMQ 5\.x actually implements/);
});
