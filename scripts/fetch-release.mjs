#!/usr/bin/env node
/*
 * Writes website/src/data/release.json from the latest GitHub release so the
 * download cards can name real files and checksums at build time.
 *
 * Never fails the build: the generated file is committed, so a rate-limited or
 * offline build falls back to the last known-good copy rather than shipping a
 * page with no download links.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'amigoer/mq-studio';
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

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'mq-studio-website' };
// Lifts the 60/hour anonymous limit to 5000 when CI provides a token.
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

let payload;
try {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) await keepExisting(`GitHub returned ${response.status}`);
  payload = await response.json();
} catch (error) {
  await keepExisting(`request failed: ${error.message}`);
}


const files = {};
let checksums = null;

for (const asset of payload.assets ?? []) {
  if (asset.name === 'SHA256SUMS.txt') {
    checksums = asset.browser_download_url;
    continue;
  }
  const match = ASSET.exec(asset.name);
  if (!match) continue;
  const [, , os, arch, ext] = match;
  // Linux ships three formats per arch, so the format is part of the key.
  const key = os === 'linux' ? `linux-${arch}-${ext}` : `${os}-${arch}`;
  files[key] = { name: asset.name, url: asset.browser_download_url, size: asset.size };
}

if (Object.keys(files).length === 0) {
  await keepExisting('release carried no recognisable package assets');
}

const release = {
  tag: payload.tag_name,
  version: payload.tag_name?.replace(/^v/, ''),
  publishedAt: payload.published_at,
  htmlUrl: payload.html_url,
  checksums,
  files,
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(release, null, 2)}\n`);
warn(`wrote ${release.tag} with ${Object.keys(files).length} assets`);
