/*
 * The Kite binary the site is built with. The version is pinned here, and a
 * download is checked against the release's checksums.txt before it runs.
 * KITE_BIN names a binary to use instead, for a build that must not download.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KITE_VERSION = '0.1.6';

const RELEASES = 'https://github.com/kite-plus/kite/releases/download';

const OS = { darwin: 'darwin', linux: 'linux' };
const ARCH = { x64: 'amd64', arm64: 'arm64' };

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export function kiteVersion(binary) {
  const out = execFileSync(binary, ['version'], { encoding: 'utf8' });
  return /kite v?(\S+)/.exec(out)?.[1] ?? 'unknown';
}

export async function kiteBinary(cacheDir) {
  if (process.env.KITE_BIN) {
    const found = kiteVersion(process.env.KITE_BIN);
    if (found !== KITE_VERSION) {
      process.stderr.write(`[kite] KITE_BIN is ${found}, the site pins ${KITE_VERSION}\n`);
    }
    return process.env.KITE_BIN;
  }

  const os = OS[process.platform];
  const arch = ARCH[process.arch];
  if (!os || !arch) throw new Error(`no Kite build for ${process.platform}/${process.arch}; set KITE_BIN`);

  const dir = join(cacheDir, `kite-${KITE_VERSION}-${os}-${arch}`);
  const binary = join(dir, 'kite');
  try {
    await access(binary);
    if (kiteVersion(binary) === KITE_VERSION) return binary;
  } catch {
    // Not cached yet, or a stale copy: fetch it below.
  }

  const archive = `kite_${KITE_VERSION}_${os}_${arch}.tar.gz`;
  const [sums, tarball] = await Promise.all([
    fetchBytes(`${RELEASES}/v${KITE_VERSION}/checksums.txt`),
    fetchBytes(`${RELEASES}/v${KITE_VERSION}/${archive}`),
  ]);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name?.replace(/^\*/, '') === archive)?.[0];
  const actual = createHash('sha256').update(tarball).digest('hex');
  if (!expected || expected !== actual) {
    throw new Error(`checksum mismatch for ${archive}: expected ${expected ?? 'none'}, got ${actual}`);
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const saved = join(dir, archive);
  await writeFile(saved, tarball);
  execFileSync('tar', ['-xzf', saved, '-C', dir, 'kite']);
  await rm(saved);
  const version = kiteVersion(binary);
  if (version !== KITE_VERSION) throw new Error(`downloaded Kite reports ${version}, expected ${KITE_VERSION}`);
  return binary;
}

/** Reads a file only if it exists. */
export async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
