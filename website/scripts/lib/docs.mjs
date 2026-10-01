/*
 * Turns the repo's docs into Kite items. The files are written to be read on
 * GitHub and stay the only copy: nothing here is committed to the site.
 */
import { joinCJKBreaks, plain } from './text.mjs';

/**
 * The docs the site carries, in reading order. `zh: null` has no Chinese
 * translation yet: the Chinese page shows the English text with a notice, so
 * the language switch never dead-ends.
 */
export const DOCS = [
  { slug: 'install', en: 'INSTALL.md', zh: 'INSTALL.zh-CN.md' },
  { slug: 'drivers', en: 'DRIVERS.md', zh: 'DRIVERS.zh-CN.md' },
  { slug: 'assistant', en: 'ASSISTANT.md', zh: 'ASSISTANT.zh-CN.md' },
  { slug: 'mcp', en: 'MCP.md', zh: 'MCP.zh-CN.md' },
  {
    slug: 'architecture',
    en: 'ARCHITECTURE.md',
    zh: null,
    // It opens on a diagram, so no paragraph of its own describes it.
    description: {
      en: 'How MQ Studio is put together: the window, the MCP server and the assistant over one set of services, the drivers beneath them, and the build.',
      zh: 'MQ Studio 的内部结构：窗口、MCP server 与 AI 助手共用的一套服务，它们之下的驱动，以及构建方式。',
    },
  },
  { slug: 'roadmap', en: 'ROADMAP.md', zh: 'ROADMAP.zh-CN.md' },
];

const BLOB = 'https://github.com/amigoer/mq-studio/blob/main/';

const ON_SITE = new Map(DOCS.flatMap((doc) => [[doc.en, doc.slug], ...(doc.zh ? [[doc.zh, doc.slug]] : [])]));

/**
 * Where a link written for GitHub goes on the site: a sibling doc the site
 * carries becomes its page, root-relative so Kite puts it under the English
 * site's path; anything else becomes the file on GitHub.
 */
export function rewriteHref(href) {
  if (!href || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
  const [target, hash = ''] = href.replace(/^\.\//, '').split('#');
  const suffix = hash ? `#${hash}` : '';
  const slug = ON_SITE.get(target);
  if (slug) return `/docs/${slug}/${suffix}`;
  const repoPath = target.startsWith('../') ? target.slice(3) : `docs/${target}`;
  return `${BLOB}${repoPath}${suffix}`;
}

const LINK = /(!?\[[^\]]*\])\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

// A doc opens with a link to its own translation, for GitHub's benefit; the
// site's header already switches language.
const LANGUAGE_LINK = /^\[(English|简体中文|中文)\]\([^)]*\)\s*$/;

/**
 * Splits off the title, drops the translation link and rewrites the links.
 * Code fences are left exactly as written.
 */
export function convert(markdown, { chinese }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  const kept = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && !title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (!fenced && LANGUAGE_LINK.test(line.trim())) continue;
    kept.push(fenced ? line : line.replace(LINK, (_all, text, href, tail) => `${text}(${rewriteHref(href)}${tail})`));
  }
  let body = kept.join('\n').replace(/^\n+/, '');
  if (chinese) body = joinCJKBreaks(body);
  return { title, body: `${body.trimEnd()}\n`, description: describe(body) };
}

/** The first paragraph of prose, for the docs index and meta descriptions. */
function describe(body, limit = 160) {
  let fenced = false;
  const paragraph = [];
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!line.trim()) {
      if (paragraph.length) break;
      continue;
    }
    if (/^\s*([#>|<]|[-*+]\s|\d+[.)]\s)/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const text = plain(paragraph.join(' '));
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('. '), cut.lastIndexOf('；'));
  return stop > limit / 2 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}
