#!/usr/bin/env node
/*
 * Builds the site into website/dist.
 *
 * Kite builds one language per site, so there are two: Chinese at the root and
 * English under /en/, the URL scheme Kite has settled on for multilingual
 * sites. Each is staged under .build/<lang>/ from its committed kite.yaml,
 * the docs and changelogs this repo already has, and the release and
 * community data; then both are built and merged. Pictures and the theme's
 * files are published once, at the root, and both languages link them there.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAvatars, renderShareImages, renderShots, SHOT } from './lib/assets.mjs';
import * as changelog from './lib/changelog.mjs';
import { communityParams, releaseParams } from './lib/data.mjs';
import { convert, DOCS } from './lib/docs.mjs';
import { kiteBinary } from './lib/kite.mjs';
import { quote } from './lib/text.mjs';
import { stableULID } from './lib/ulid.mjs';

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(WEBSITE);
const BUILD = join(WEBSITE, '.build');
const CACHE = join(WEBSITE, '.cache');
const DIST = join(WEBSITE, 'dist');

export const LANGUAGES = [
  { code: 'zh', chinese: true, changelog: 'CHANGELOG.zh-CN.md', path: '' },
  { code: 'en', chinese: false, changelog: 'CHANGELOG.md', path: 'en' },
];

const log = (message) => process.stderr.write(`[website] ${message}\n`);

function gitDate(path) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', path], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const frontMatter = (fields) =>
  `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? quote(value) : value}`)
    .join('\n')}\n---\n\n`;

async function writeDocs(stage, language) {
  const dir = join(stage, 'content', 'docs');
  await mkdir(dir, { recursive: true });
  for (const [index, doc] of DOCS.entries()) {
    const file = (language.chinese && doc.zh) || doc.en;
    const source = await readFile(join(REPO, 'docs', file), 'utf8');
    const converted = convert(source, { chinese: language.chinese && Boolean(doc.zh) });
    const { title, body } = converted;
    const description = doc.description?.[language.code] ?? converted.description;
    const fields = {
      id: stableULID(`doc:${language.code}:${doc.slug}`),
      title,
      slug: doc.slug,
      weight: index + 1,
      description,
      source: `docs/${file}`,
      untranslated: language.chinese && !doc.zh ? true : undefined,
      updated_at: gitDate(`docs/${file}`),
    };
    await writeFile(join(dir, `${doc.slug}.md`), frontMatter(fields) + body);
  }
}

async function writeReleases(stage, language) {
  const dir = join(stage, 'content', 'changelog');
  await mkdir(dir, { recursive: true });
  const releases = changelog.parse(await readFile(join(REPO, language.changelog), 'utf8')).filter((r) => !r.unreleased);
  for (const [index, release] of releases.entries()) {
    // Releases cut on one day keep the file's order, newest first.
    const second = String(releases.length - index).padStart(2, '0');
    const published = `${release.date}T00:00:${second}+08:00`;
    const fields = {
      id: stableULID(`release:${language.code}:${release.version}`, Date.parse(published)),
      title: release.version,
      slug: release.slug,
      published_at: published,
      description: changelog.summary(release),
      version: release.version,
      source: `${changelog.REPO}/blob/main/${language.changelog}#${changelog.githubAnchor(release.version, release.date)}`,
    };
    await writeFile(join(dir, `${release.slug}.md`), frontMatter(fields) + changelog.body(release));
  }
  return releases.map((release) => ({
    version: release.version,
    slug: release.slug,
    date: release.date,
    url: `/changelog/${release.slug}/`,
    summary: changelog.summary(release),
  }));
}

// The committed kite.yaml leaves `params: {}` under `site:` for this. JSON is
// YAML too, so the data goes in as one flow mapping.
function injectParams(config, params, file) {
  const marker = /^  params: \{\}.*$/m;
  if (!marker.test(config)) throw new Error(`${file} has no "  params: {}" line under site: to fill`);
  return config.replace(marker, `  params: ${JSON.stringify(params)}`);
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)));
    else out.push(relative(base, path));
  }
  return out;
}

async function main() {
  const kite = await kiteBinary(CACHE);
  const release = JSON.parse(await readFile(join(WEBSITE, 'data', 'release.json'), 'utf8'));
  const community = JSON.parse(await readFile(join(WEBSITE, 'data', 'community.json'), 'utf8'));

  await rm(BUILD, { recursive: true, force: true });
  await mkdir(BUILD, { recursive: true });

  // Pictures are rendered into the cache, which survives a rebuild.
  const pictures = join(CACHE, 'pictures');
  await renderShots(join(REPO, 'docs', 'images', 'readme'), pictures);
  await renderShareImages(join(REPO, 'docs', 'images', 'readme'), pictures);
  const shared = join(BUILD, 'static');
  await cp(join(WEBSITE, 'static'), shared, { recursive: true });
  await cp(pictures, shared, { recursive: true });
  await copyAvatars(join(WEBSITE, 'data', 'avatars'), shared);

  // The pages link the theme's stylesheet and script by a hash of both, so
  // either can be cached for good and still never go stale.
  const theme = join(WEBSITE, 'themes', 'mq-studio', 'static', 'mq-studio');
  const asset = createHash('sha256')
    .update(await readFile(join(theme, 'site.css')))
    .update(await readFile(join(theme, 'site.js')))
    .digest('hex')
    .slice(0, 10);

  const base = {
    root: '/',
    origin: 'https://mq-studio.amigoer.com',
    asset,
    release: releaseParams(release),
    community: communityParams(community),
    shot: SHOT,
  };

  for (const language of LANGUAGES) {
    const stage = join(BUILD, language.code);
    await mkdir(stage, { recursive: true });
    await symlink(join(WEBSITE, 'themes'), join(stage, 'themes'));
    await symlink(shared, join(stage, 'static'));
    await writeDocs(stage, language);
    const releases = await writeReleases(stage, language);

    const file = join(WEBSITE, 'sites', language.code, 'kite.yaml');
    const config = await readFile(file, 'utf8');
    await writeFile(join(stage, 'kite.yaml'), injectParams(config, { ...base, releases }, file));

    log(`building ${language.code}`);
    execFileSync(kite, ['build', '--verify', '-o', join(BUILD, `out-${language.code}`)], {
      cwd: stage,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  }

  // Chinese at the root, English under /en/ without the files both share:
  // its pages link the root copies.
  await rm(DIST, { recursive: true, force: true });
  await cp(join(BUILD, 'out-zh'), DIST, { recursive: true });
  const rootOnly = new Set([
    ...(await listFiles(shared)),
    ...(await listFiles(join(WEBSITE, 'themes', 'mq-studio', 'static'))),
  ]);
  for (const file of await listFiles(join(BUILD, 'out-en'))) {
    if (rootOnly.has(file)) continue;
    const to = join(DIST, 'en', file);
    await mkdir(dirname(to), { recursive: true });
    await cp(join(BUILD, 'out-en', file), to);
  }
  log(`wrote ${relative(REPO, DIST)}`);
}

main().catch((error) => {
  log(error.stack ?? String(error));
  process.exit(1);
});
