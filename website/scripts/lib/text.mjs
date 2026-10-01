/*
 * Text rules shared by the changelog and the docs.
 *
 * The repo's markdown wraps prose at 80 columns. A soft break between two
 * Chinese characters renders as a space, which is not how Chinese is written;
 * between two Latin words it is the word boundary and has to stay. The class
 * is the desktop app's (frontend/src/components/markdown.tsx), plus the em
 * dash and the ellipsis, because the Chinese files start a wrapped line with
 * "——".
 */
export const CJK = /[⺀-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯—…]/;

// The character a reader sees at a join is not always the one at the edge: a
// line ending in `**` closes emphasis around the ideograph before it.
const TRAILING_MARKERS = /[*_`~]+$/;
const LEADING_MARKERS = /^[*_`~]+/;

// Full-width punctuation takes no space on either side, even beside Latin:
// "、Kimi", not "、 Kimi".
const PUNCTUATION = /[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/;

const cjkJoin = (tail, head) => {
  const left = tail.replace(TRAILING_MARKERS, '').slice(-1);
  const right = head.replace(LEADING_MARKERS, '').slice(0, 1);
  return (CJK.test(left) && CJK.test(right)) || PUNCTUATION.test(left) || PUNCTUATION.test(right);
};

export function joinLines(lines) {
  return lines.reduce((joined, line) => {
    if (joined === '') return line;
    return joined + (cjkJoin(joined, line) ? '' : ' ') + line;
  }, '');
}

const FENCE = /^\s*(```|~~~)/;
// A line that starts a block of its own rather than continuing a paragraph.
const BLOCK_START = /^\s*([#>|]|[-*+]\s|\d+[.)]\s|<(div|p|table|details|summary|picture|figure|img|br|hr|!--)\b)/i;
// A line no paragraph continues from.
const BLOCK_END = /^\s*(#|\||<(div|p|table|details|summary|picture|figure|img|br|hr|!--)\b)/i;

/**
 * Joins the soft breaks of a whole markdown document where both sides are
 * Chinese, leaving code fences, tables and every other block start alone.
 */
export function joinCJKBreaks(markdown) {
  const out = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    const previous = out[out.length - 1];
    if (
      !fenced &&
      previous !== undefined &&
      previous.trim() !== '' &&
      line.trim() !== '' &&
      !BLOCK_START.test(line) &&
      !FENCE.test(previous) &&
      !BLOCK_END.test(previous) &&
      cjkJoin(previous.trimEnd(), line.trimStart())
    ) {
      out[out.length - 1] = previous.trimEnd() + line.trimStart();
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Markdown inline syntax dropped, for descriptions and excerpts. */
export function plain(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<kbd>([^<]*)<\/kbd>/g, '$1')
    .replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/gi, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A string as a YAML double-quoted scalar; JSON's escaping is valid there. */
export const quote = (value) => JSON.stringify(String(value));
