import zhSource from '@repo/CHANGELOG.zh-CN.md?raw';
import enSource from '@repo/CHANGELOG.md?raw';
import type { Locale } from '@/i18n';
import { REPO_URL } from '@/lib/downloads';
import { parse, type Release } from './changelog-parse';

export type {
  Block,
  ListBlock,
  ListItem,
  ParagraphBlock,
  Release,
  Section,
  SubheadingBlock,
} from './changelog-parse';

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
  // Glue a Chinese dash to the word before it, so a line never opens with it.
  const glued = text.replace(/ ——/g, '\u00a0——');
  return render(glued.replace(/[&<>"]/g, (ch) => ESCAPE[ch]));
}
