/*
 * A parser for the repo's own CHANGELOG files rather than a markdown dependency.
 * They follow Keep a Changelog strictly and use almost none of markdown: no
 * markdown links, code fences, tables or nested lists, only `**bold**` and
 * `` `code` `` inline, plus a bare `#61` where a bullet answers an issue --
 * written bare because the files wrap at 80 columns, and turned into a link by
 * `inline` in changelog.ts. Parsing the shape directly keeps the page
 * dependency-free and lets the release headings become real anchors.
 *
 * Kept free of Vite-only imports (`?raw`, the `@/` alias) so `node --test` can
 * load it as it is.
 */

export interface ListItem {
  /**
   * The bullet's own text first. A blank line followed by an indented block
   * is the bullet's next paragraph, the way markdown reads it.
   */
  paragraphs: string[];
}

export interface ListBlock {
  type: 'list';
  items: ListItem[];
}

/** A line that is nothing but `**bold**`: the files use it as a sub-section title. */
export interface SubheadingBlock {
  type: 'subheading';
  text: string;
}

/** Prose inside a `###` section that is neither a bullet nor a bold line. */
export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}

export type Block = ListBlock | SubheadingBlock | ParagraphBlock;

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

/*
 * The files wrap prose at 80 columns, so most paragraphs and bullets span
 * several lines. A soft line break between two CJK characters is a space in
 * HTML, and a space is not how Chinese is written; between two Latin words it
 * is the word boundary and has to stay. Same character class as the desktop
 * app's frontend/src/components/markdown.tsx, plus the em dash and ellipsis:
 * the Chinese file starts a wrapped line with "——" and that dash sits outside
 * the CJK blocks.
 */
const CJK =
  /[⺀-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯—…]/;

/*
 * The character a reader will actually see at a join, which is not always the
 * one at the edge: a line ending in `**` closes emphasis, and comparing that
 * asterisk instead of the ideograph before it would put the space back in.
 */
const TRAILING_MARKERS = /[*_`~]+$/;
const LEADING_MARKERS = /^[*_`~]+/;

export function joinLines(lines: string[]): string {
  return lines.reduce((joined, line) => {
    if (joined === '') return line;
    const tail = joined.replace(TRAILING_MARKERS, '').slice(-1);
    const head = line.replace(LEADING_MARKERS, '').slice(0, 1);
    return joined + (CJK.test(tail) && CJK.test(head) ? '' : ' ') + line;
  }, '');
}

export function slug(version: string, unreleased: boolean): string {
  // The unreleased heading is the one page whose id cannot come from its own
  // text: it is written "Unreleased" in one language and "未发布" in the other,
  // and the two have to land on the same path or the language switch 404s.
  if (unreleased) return 'unreleased';

  const ascii = version.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  // A heading that slugifies to nothing still needs a usable id. The `v`
  // prefix keeps it from starting with a digit: `#0.0.3` is a valid fragment
  // but an invalid CSS selector, which would throw inside querySelector.
  return ascii ? `v${ascii}` : 'release';
}

type Target = 'intro' | 'item' | 'section';

export function parse(source: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;
  let list: ListBlock | null = null;
  // The last bullet. It outlives the blank line after it, because an indented
  // block on the far side of that blank line is the bullet's next paragraph.
  let item: ListItem | null = null;
  // Lines of the paragraph being read, and where it goes once complete.
  let para: string[] | null = null;
  let target: Target = 'intro';

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
      item = null;
      continue;
    }

    // The file's own preamble, before the first release heading.
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
        // A list before any `###`: give it an untitled section to live in.
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
      // A blank line ends the paragraph, not the list: bullets separated by
      // blank lines are still one list, and `item` stays for the case below.
      flush();
      continue;
    }

    if (indented && item) {
      // Wrapped continuation of the bullet, or, after a blank line, the
      // bullet's next paragraph.
      if (para && target === 'item') {
        para.push(line.trim());
      } else {
        flush();
        para = [line.trim()];
        target = 'item';
      }
      continue;
    }

    // Prose: the release intro before the first `###`, or a paragraph inside a
    // section. Either way it ends whatever list was open.
    const where: Target = section ? 'section' : 'intro';
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

  // The unreleased heading is empty most of the time; showing it as a version
  // with nothing under it just adds noise.
  return releases.filter((r) => !(r.unreleased && r.sections.length === 0 && !r.intro.length));
}
