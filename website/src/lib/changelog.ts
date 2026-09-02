import zhSource from '@repo/CHANGELOG.zh-CN.md?raw';
import enSource from '@repo/CHANGELOG.md?raw';
import type { Locale } from '@/i18n';
import { REPO_URL } from '@/lib/downloads';

/*
 * A parser for the repo's own CHANGELOG files rather than a markdown dependency.
 * They follow Keep a Changelog strictly and use almost none of markdown: no
 * markdown links, code fences, tables or nested lists, only `**bold**` and
 * `` `code` `` inline, plus a bare `#61` where a bullet answers an issue --
 * written bare because the files wrap at 80 columns, and turned into a link by
 * `inline` below. Parsing the shape directly keeps the page dependency-free and
 * lets the release headings become real anchors.
 */

export interface ListBlock {
  type: 'list';
  items: string[];
}

export interface SubheadingBlock {
  type: 'subheading';
  text: string;
}

export type Block = ListBlock | SubheadingBlock;

export interface Section {
  title: string;
  blocks: Block[];
}

export interface Release {
  /** "0.0.3", or the unreleased heading's own text. */
  version: string;
  /** Anchor and lookup key; slugified so "未发布" still yields a usable id. */
  id: string;
  date: string | null;
  /** Paragraphs between the version heading and the first `###`. */
  intro: string[];
  sections: Section[];
  /** True for the "[Unreleased]" / "[未发布]" heading, which has no date. */
  unreleased: boolean;
}

const HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\S+))?\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const SUBHEADING = /^\*\*(.+)\*\*\s*$/;
const ITEM = /^-\s+(.+)$/;

function slug(version: string, unreleased: boolean): string {
  // The unreleased heading is the one page whose id cannot come from its own
  // text: it is written "Unreleased" in one language and "未发布" in the other,
  // and the two have to land on the same path or the language switch 404s.
  // That stayed invisible for as long as the section was empty in both files
  // at once, because an empty one is dropped below.
  if (unreleased) return 'unreleased';

  const ascii = version.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  // A heading that slugifies to nothing still needs a usable id. The `v`
  // prefix keeps it from starting with a digit: `#0.0.3` is a valid fragment
  // but an invalid CSS selector, which would throw inside querySelector.
  return ascii ? `v${ascii}` : 'release';
}

function parse(source: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;
  let list: ListBlock | null = null;

  const lines = source.split('\n');

  for (const raw of lines) {
    const line = raw.trimEnd();

    const heading = HEADING.exec(line);
    if (heading) {
      const [, version, date] = heading;
      release = {
        version,
        id: slug(version, !date),
        date: date ?? null,
        intro: [],
        sections: [],
        unreleased: !date,
      };
      releases.push(release);
      section = null;
      list = null;
      continue;
    }

    if (!release) continue;

    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      section = { title: sectionMatch[1], blocks: [] };
      release.sections.push(section);
      list = null;
      continue;
    }

    const subheading = SUBHEADING.exec(line);
    if (subheading && section) {
      section.blocks.push({ type: 'subheading', text: subheading[1] });
      list = null;
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      if (!section) {
        // A list before any `###`: give it an untitled section to live in.
        section = { title: '', blocks: [] };
        release.sections.push(section);
      }
      if (!list) {
        list = { type: 'list', items: [] };
        section.blocks.push(list);
      }
      list.items.push(item[1]);
      continue;
    }

    if (!line.trim()) {
      // A blank line ends the current list but not the section: the next `- `
      // after one starts a new block rather than continuing the old one.
      list = null;
      continue;
    }

    // An indented line continues the previous bullet - the files wrap prose at
    // 80 columns, so most bullets span several lines.
    if (list && /^\s+/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    if (section) {
      section.blocks.push({ type: 'subheading', text: line.trim() });
    } else {
      release.intro.push(line.trim());
    }
  }

  // The unreleased heading is empty most of the time; showing it as a version
  // with nothing under it just adds noise.
  return releases.filter((r) => !(r.unreleased && r.sections.length === 0 && !r.intro.length));
}

const parsed: Record<Locale, Release[]> = {
  zh: parse(zhSource),
  en: parse(enSource),
};

export function releases(locale: Locale): Release[] {
  return parsed[locale];
}

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/**
 * One pass, alternation ordered by precedence: code first, so a bullet writing
 * `#61` as a literal keeps it. Replacing in a single pass is what makes the
 * issue rule safe - `replace` never rescans its own output, so the class names
 * and the href emitted here can never be read back as markup.
 *
 * The text is escaped before it gets here, and bold recurses on the already
 * escaped run: code nested inside bold rendered back when this was three
 * sequential replaces, and a trailing reference has to link inside one too.
 */
const INLINE = /`([^`\n]+)`|\*\*([^*]+)\*\*|#(\d+)/g;

function render(escaped: string): string {
  return escaped.replace(INLINE, (_all, code?: string, strong?: string, issue?: string) => {
    if (code !== undefined) {
      return `<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]">${code}</code>`;
    }
    if (strong !== undefined) {
      return `<strong class="font-semibold text-foreground">${render(strong)}</strong>`;
    }
    // `/issues/` is right for a pull request too - GitHub redirects it - so the
    // two never have to be told apart.
    return `<a class="underline underline-offset-2 hover:text-foreground" href="${REPO_URL}/issues/${issue}">#${issue}</a>`;
  });
}

/**
 * Renders the inline constructs the files use. The text is escaped first, so a
 * future changelog entry containing markup cannot inject it.
 */
export function inline(text: string): string {
  return render(text.replace(/[&<>"]/g, (ch) => ESCAPE[ch]));
}
