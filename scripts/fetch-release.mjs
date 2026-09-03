#!/usr/bin/env node
/*
 * Writes website/src/data/release.json from the published release manifest so
 * the download cards can name real files, sizes and checksums at build time.
 *
 * It reads the same manifest the app does, through the same mirrors in the same
 * order, so the site and the updater cannot disagree about what the latest
 * release is. The site itself ships no JavaScript for this: it cannot measure
 * which mirror a visitor can reach, so every card carries the preferred link and
 * a fallback, both resolved here.
 *
 * Never fails the build: the generated file is committed, so a build that
 * cannot reach any mirror falls back to the last known-good copy rather than
 * shipping a page with no download links.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MIRRORS, REPOSITORY } from './mirrors.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'website', 'src', 'data', 'release.json');

// mq-studio-<version>-<os>-<arch>.<ext>, the scheme package.yml normalises onto.
const ASSET = /^mq-studio-(.+?)-(mac|windows|linux)-(amd64|arm64)\.(dmg|exe|deb|rpm|AppImage)$/;

function warn(message) {
  process.stderr.write(`[fetch-release] ${message}\n`);
}

async function keepExisting(reason) {
  warn(`${reason}; keeping the committed release.json`);
  try {
    const existing = JSON.parse(await readFile(OUT, 'utf8'));
    warn(`fallback is ${existing.tag ?? 'unknown'}`);
  } catch {
    warn('no committed release.json to fall back to - download links will be generic');
  }
  process.exit(0);
}

/** Joins a mirror's asset base to a manifest path. */
function assetURL(mirror, path) {
  return `${mirror.assets.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/**
 * Reads the manifest from the first mirror that serves one. In preference
 * order rather than raced: a build has no user waiting on it, so the simpler
 * loop is worth more here than the milliseconds.
 */
async function fetchManifest() {
  const reasons = [];
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror.manifest, {
        headers: { accept: 'application/json', 'user-agent': 'mq-studio-website' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        reasons.push(`${mirror.name}: ${response.status}`);
        continue;
      }
      return { mirror, manifest: await response.json() };
    } catch (error) {
      reasons.push(`${mirror.name}: ${error.message}`);
    }
  }
  await keepExisting(`no mirror served a manifest (${reasons.join('; ')})`);
}

const { mirror: served, manifest } = await fetchManifest();
if (!manifest?.tag || !manifest.files) {
  await keepExisting(`${served.name} served something that is not a manifest`);
}

// The preferred mirror for a visitor, and the one the card offers beside it.
// Taken from the manifest rather than from MIRRORS so a release that adds a
// mirror is reflected without the site being redeployed against new code.
const [primary, alternate] = manifest.mirrors?.length ? manifest.mirrors : MIRRORS;

const files = {};
for (const [name, file] of Object.entries(manifest.files)) {
  const match = ASSET.exec(name);
  if (!match) continue;
  const [, , os, arch, ext] = match;
  // Linux ships three formats per arch, so the format is part of the key.
  const key = os === 'linux' ? `linux-${arch}-${ext}` : `${os}-${arch}`;
  files[key] = {
    name,
    url: assetURL(primary, file.path),
    alternate: alternate ? assetURL(alternate, file.path) : '',
    size: file.size ?? 0,
  };
}

if (Object.keys(files).length === 0) {
  await keepExisting('the manifest carried no recognisable packages');
}

const release = {
  tag: manifest.tag,
  version: manifest.version,
  publishedAt: manifest.publishedAt,
  htmlUrl: manifest.releaseURL ?? `${REPOSITORY}/releases/tag/${manifest.tag}`,
  checksums: manifest.checksums ? assetURL(primary, manifest.checksums) : null,
  // Named so a stale page can be traced back to the mirror that produced it.
  mirrors: { primary: primary.name, alternate: alternate?.name ?? null },
  files,
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(release, null, 2)}\n`);
warn(`wrote ${release.tag} from ${served.name} with ${Object.keys(files).length} packages`);
