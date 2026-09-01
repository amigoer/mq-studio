/*
 * The docs are written to be read on GitHub, so they link to sibling .md files.
 * Rendered on the site those would 404. Rewrite each one to the page that
 * actually holds it, or to the file on GitHub when the site does not carry it.
 *
 * A Sätteri hast plugin: Rust filters to <a> and only those cross into JS.
 */

/** Docs the site renders itself, keyed by the filename links use. */
const ROUTES = {
  'INSTALL.md': '/en/docs/install/',
  'INSTALL.zh-CN.md': '/docs/install/',
  // English only; the Chinese route serves the same text with a notice.
  'ARCHITECTURE.md': '/en/docs/architecture/',
  'ROADMAP.md': '/en/docs/roadmap/',
  'ROADMAP.zh-CN.md': '/docs/roadmap/',
};

const BLOB = 'https://github.com/amigoer/mq-studio/blob/main/';

export function rewriteDocHref(href) {
  // Absolute, anchor-only and root-relative links are already fine.
  if (!href || /^([a-z]+:|#|\/)/i.test(href)) return null;
  const [target, hash = ''] = href.replace(/^\.\//, '').split('#');
  if (!target.endsWith('.md')) return null;

  const suffix = hash ? `#${hash}` : '';
  const route = ROUTES[target];
  if (route) return `${route}${suffix}`;

  // ../ escapes docs/ and lands at the repo root; everything else is a sibling.
  const repoPath = target.startsWith('../') ? target.slice(3) : `docs/${target}`;
  return `${BLOB}${repoPath}${suffix}`;
}

export const hastDocLinks = {
  name: 'doc-links',
  element: {
    filter: ['a'],
    visit(node, ctx) {
      const next = rewriteDocHref(node.properties?.href);
      if (next) ctx.setProperty(node, 'href', next);
    },
  },
};
