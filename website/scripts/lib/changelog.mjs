/*
 * Turns the repo's CHANGELOG files into one Kite item per release.
 *
 * The files follow Keep a Changelog strictly and use almost none of markdown:
 * only `**bold**` and `` `code` `` inline, plus a bare `#61` where a bullet
 * answers an issue, written bare because the files wrap at 80 columns. The
 * parser reads that shape directly, so each release becomes a page of its own
 * with a stable address, which no markdown renderer would split out.
 */
import { joinLines, plain } from './text.mjs';

const HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\S+))?\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const SUBHEADING = /^\*\*(.+)\*\*\s*$/;
const ITEM = /^-\s+(.+)$/;

export const REPO = 'https://github.com/amigoer/mq-studio';

/**
 * The page a release lives at. The unreleased heading reads "Unreleased" in
 * one file and "未发布" in the other, and both have to land on one path.
 */
export function slug(version, unreleased) {
  if (unreleased) return 'unreleased';
  const ascii = version.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  return ascii ? `v${ascii}` : 'release';
}

/** GitHub's anchor for a release heading, as release-notes.mjs links it. */
export function githubAnchor(version, date) {
  const text = date ? `[${version}] - ${date}` : `[${version}]`;
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
}

export function parse(source) {
  const releases = [];
  let release = null;
  let section = null;
  let list = null;
  // The last bullet outlives the blank line after it: an indented block on
  // the far side of that line is the bullet's next paragraph.
  let item = null;
  let para = null;
  let target = 'intro';

  const flush = () => {
    if (para && release) {
      const text = joinLines(para);
      if (target === 'item' && item) item.paragraphs.push(text);
      else if (target === 'section' && section) section.blocks.push({ type: 'paragraph', text });
      else release.intro.push(text);
    }
    para = null;
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    const indented = /^\s/.test(raw);

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const [, version, date] = heading;
      release = { version, slug: slug(version, !date), date: date ?? null, intro: [], sections: [], unreleased: !date };
      releases.push(release);
      section = null;
      list = null;
      item = null;
      continue;
    }
    if (!release) continue;

    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      flush();
      section = { title: sectionMatch[1], blocks: [] };
      release.sections.push(section);
      list = null;
      item = null;
      continue;
    }

    const subheading = SUBHEADING.exec(line);
    if (subheading && section) {
      flush();
      section.blocks.push({ type: 'subheading', text: subheading[1] });
      list = null;
      item = null;
      continue;
    }

    const itemMatch = ITEM.exec(line);
    if (itemMatch) {
      flush();
      if (!section) {
        section = { title: '', blocks: [] };
        release.sections.push(section);
      }
      if (!list) {
        list = { type: 'list', items: [] };
        section.blocks.push(list);
      }
      item = { paragraphs: [] };
      list.items.push(item);
      para = [itemMatch[1]];
      target = 'item';
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (indented && item) {
      if (para && target === 'item') {
        para.push(line.trim());
      } else {
        flush();
        para = [line.trim()];
        target = 'item';
      }
      continue;
    }

    const where = section ? 'section' : 'intro';
    if (para && target === where) {
      para.push(line.trim());
    } else {
      flush();
      list = null;
      item = null;
      para = [line.trim()];
      target = where;
    }
  }
  flush();

  // An empty unreleased heading is the normal state between releases.
  return releases.filter((r) => !(r.unreleased && r.sections.length === 0 && r.intro.length === 0));
}

/**
 * Links a bare issue reference. Code spans go first in the alternation so a
 * `#61` written as a literal stays one; a single pass never rescans its own
 * output.
 */
export function linkIssues(text) {
  return text.replace(/(`[^`\n]+`)|(^|[^\w&/[])#(\d+)\b/g, (all, code, before, number) =>
    code !== undefined ? code : `${before}[#${number}](${REPO}/issues/${number})`,
  );
}

// A Chinese dash stays on the line of the word before it.
const glue = (text) => text.replace(/ ——/g, ' ——');

const inline = (text) => linkIssues(glue(text));

export function body(release) {
  const out = [];
  for (const text of release.intro) out.push(inline(text), '');
  for (const section of release.sections) {
    if (section.title) out.push(`## ${section.title}`, '');
    for (const block of section.blocks) {
      if (block.type === 'subheading') out.push(`**${inline(block.text)}**`, '');
      else if (block.type === 'paragraph') out.push(inline(block.text), '');
      else {
        for (const item of block.items) {
          const [first = '', ...rest] = item.paragraphs;
          out.push(`- ${inline(first)}`);
          for (const text of rest) out.push('', `  ${inline(text)}`);
          out.push('');
        }
      }
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** The release's first sentence or two, for listings and meta descriptions. */
export function summary(release, limit = 160) {
  const text = plain(release.intro[0] ?? release.sections[0]?.blocks.find((b) => b.type === 'paragraph')?.text ?? '');
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('. '), cut.lastIndexOf('；'));
  return stop > limit / 2 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}
