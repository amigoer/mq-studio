#!/usr/bin/env node
/*
 * Checks the built site in website/dist for what a build can lose without
 * failing: each of these once rendered fine and was wrong, or would. Run it
 * after `npm run build`; it exits 1 with every failure listed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
const failures = [];
const fail = (message) => failures.push(message);
const read = (path) => readFileSync(join(DIST, path), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(relative(DIST, path));
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('website/dist does not exist; run the build first');
  process.exit(1);
}
const files = walk(DIST);
const pages = files.filter((file) => file.endsWith('.html'));

// The two home pages: what crawlers and readers without a script still get.
for (const home of ['index.html', 'en/index.html']) {
  const html = read(home);
  for (const tag of ['rel="canonical"', 'property="og:title"', 'application/ld+json', 'hreflang="zh-CN"', 'hreflang="en"']) {
    if (!html.includes(tag)) fail(`${home} is missing ${tag}`);
  }
  // A third-party font request is unreliable from mainland China.
  if (/fonts\.(googleapis|gstatic)\.com/.test(html)) fail(`${home} requests fonts from a third party`);
  // Every package has to be in the markup, so the cards work without the script.
  const names = new Set(html.match(/mq-studio-[0-9.]+-(mac|windows|linux)-(amd64|arm64)\.(dmg|exe|deb|rpm|AppImage)/g) ?? []);
  if (names.size !== 10) fail(`${home} names ${names.size} release files, expected 10`);
  if (!html.includes('data-theme-toggle')) fail(`${home} lost the theme toggle`);
  // Blocking and ahead of the stylesheet, or dark readers see a light flash.
  const head = html.slice(0, html.indexOf('</head>'));
  const init = head.indexOf('mq-studio:theme');
  const sheet = head.indexOf('rel="stylesheet"');
  if (init < 0 || sheet < 0 || init > sheet) fail(`${home}: the theme script must sit in <head> before the stylesheet`);
  if (!html.includes('id="download"')) fail(`${home} has no download section`);
  if (!html.includes('class="person"')) fail(`${home} lists no contributors`);
}

// Contributor avatars are served locally, like the fonts.
for (const page of pages) {
  if (read(page).includes('avatars.githubusercontent.com')) fail(`${page} loads an avatar from GitHub`);
}

// The changelog is parsed by hand; a format change would not fail the build,
// it would render empty pages.
const versions = {};
for (const root of ['changelog', 'en/changelog']) {
  const releases = pages.filter((page) => new RegExp(`^${root}/v[^/]+/index\\.html$`).test(page));
  versions[root] = releases.map((page) => page.split('/').at(-2)).sort();
  if (releases.length < 3) fail(`expected at least 3 release pages under ${root}, found ${releases.length}`);
  for (const page of releases) {
    const html = read(page);
    if ((html.match(/<article/g) ?? []).length !== 1) fail(`${page} should hold exactly one release`);
    if (!html.includes('aria-current="page"')) fail(`${page} does not mark its release in the list`);
    // A bare "#61" is linked to its issue; one left bare is a number the
    // reader cannot follow. Code and links are dropped first.
    const prose = (html.match(/<div class="prose">([\s\S]*?)<\/div>\s*(<footer|<\/article)/) ?? [])[1] ?? '';
    const text = prose.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<a [^>]*>[\s\S]*?<\/a>/g, '');
    const bare = text.match(/(^|[^&\w/])#\d+\b/);
    if (bare) fail(`${page} has an unlinked issue reference: ${bare[0].trim()}`);
  }
}
if (versions.changelog?.join() !== versions['en/changelog']?.join()) {
  fail(`the two changelogs carry different releases: ${versions.changelog} vs ${versions['en/changelog']}`);
}

// The docs are the repo's own markdown; their sibling .md links only work on
// GitHub, and a doc that opens with its translation link repeats the header.
const DOCS = ['install', 'drivers', 'assistant', 'mcp', 'architecture', 'roadmap'];
for (const root of ['docs', 'en/docs']) {
  for (const slug of DOCS) {
    const page = `${root}/${slug}/index.html`;
    if (!files.includes(page)) {
      fail(`${page} is missing`);
      continue;
    }
    const html = read(page);
    const raw = (html.match(/href="[^"]*\.md[^"]*"/g) ?? []).filter((href) => !href.includes('github.com'));
    if (raw.length) fail(`${page} still links raw markdown: ${raw.join(' ')}`);
    if (/<div class="prose">\s*<p><a [^>]*>(English|简体中文|中文)<\/a><\/p>/.test(html)) {
      fail(`${page} opens with the in-prose language link`);
    }
  }
}
if (!read('docs/architecture/index.html').includes('data-untranslated')) {
  fail('the Chinese architecture page lost its untranslated notice');
}

// The language switch keeps the reader on the same page, which only works
// while both languages publish the same routes.
const zhRoutes = pages.filter((page) => !page.startsWith('en/')).sort();
const enRoutes = pages.filter((page) => page.startsWith('en/')).map((page) => page.slice(3)).sort();
const onlyZh = zhRoutes.filter((page) => !enRoutes.includes(page));
const onlyEn = enRoutes.filter((page) => !zhRoutes.includes(page));
if (onlyZh.length || onlyEn.length) fail(`the languages publish different pages: zh only ${onlyZh}; en only ${onlyEn}`);

// Every address a page points at inside the site exists. The English pages
// link the root copies of the shared files, which the merge relies on.
const exists = (path) => {
  const target = join(DIST, decodeURIComponent(path));
  if (!target.startsWith(DIST)) return false;
  if (existsSync(target) && statSync(target).isFile()) return true;
  return existsSync(join(target, 'index.html'));
};
const broken = new Set();
for (const page of pages) {
  const html = read(page);
  const urls = [
    ...[...html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/\ssrcset="([^"]*)"/g)].flatMap((match) => match[1].split(',').map((entry) => entry.trim().split(/\s+/)[0])),
  ];
  for (const url of urls) {
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    const path = url.split(/[?#]/)[0];
    if (!exists(path)) broken.add(`${page} -> ${url}`);
  }
}
for (const link of broken) fail(`broken link: ${link}`);

if (!read('mq-studio/site.css').includes(':root[data-theme="dark"]')) fail('the dark token block is gone from site.css');
for (const file of ['favicon.svg', 'favicon.png', 'robots.txt', '_headers', 'sitemap.xml', 'en/sitemap.xml', '404.html', 'en/404.html']) {
  if (!files.includes(file)) fail(`${file} is missing`);
}
if (!read('robots.txt').includes('/en/sitemap.xml')) fail('robots.txt does not list the English sitemap');

// The pages ship one small script; this fails if something drags in more.
const js = files.filter((file) => file.endsWith('.js')).reduce((sum, file) => sum + statSync(join(DIST, file)).size, 0);
if (js > 20000) fail(`external JS grew to ${js} bytes; the site is meant to ship almost none`);

if (failures.length) {
  for (const message of failures) console.error(`✗ ${message}`);
  process.exit(1);
}
console.log(`website/dist: ${pages.length} pages, ${versions.changelog.length} releases per language, ${js} bytes of JS, every link resolves`);
