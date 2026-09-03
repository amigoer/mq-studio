#!/usr/bin/env node
/*
 * Writes the release manifest that the in-app updater and the website both read.
 *
 * It replaces the GitHub releases API as the answer to "what is the newest
 * version and which files does it have": a static JSON object any mirror can
 * serve, so a client that cannot reach github.com can still both check and
 * download. Which mirror it uses is decided at runtime by the client, not here.
 *
 * Every digest is inlined rather than left to the SHA256SUMS.txt beside the
 * packages. That makes the manifest the only thing a client has to trust - a
 * mirror carries bytes but cannot lie about them - and removes a separate
 * request that could fail on its own, which is exactly how the failure this
 * replaces was reported.
 *
 * Usage:
 *   RELEASE_TAG=v0.1.0 node scripts/build-manifest.mjs \
 *     --dir release-files --notes notes.md --out release-files/manifest.json
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { MIRRORS, REPOSITORY } from './mirrors.mjs';

// The scheme package.yml normalises every artifact onto.
const ASSET = /^mq-studio-(.+?)-(mac|windows|linux)-(amd64|arm64)\.(dmg|exe|deb|rpm|AppImage)$/;

const CHECKSUM_FILE = 'SHA256SUMS.txt';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Bump when a change would make an older client misread this file. Clients
// refuse a manifest whose schema is newer than the one they know, so this is
// the field that lets an old build fail with "download it by hand" instead of
// guessing.
const SCHEMA = 1;

function fail(message) {
  process.stderr.write(`[build-manifest] ${message}\n`);
  process.exit(1);
}

/** Reads `--name value` pairs. Unknown flags are an error, not a no-op. */
function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith('--') || value === undefined) {
      fail(`bad argument: ${flag}`);
    }
    parsed[flag.slice(2)] = value;
  }
  return parsed;
}

/**
 * Parses `shasum -a 256` output into name -> digest, accepting the `*` binary
 * marker and a `./` prefix. Kept in step with ParseChecksums in
 * internal/update/download.go, which reads the same file for manual verification.
 */
function parseChecksums(content) {
  const sums = new Map();
  for (const line of content.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2) continue;
    const digest = fields[0].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) continue;
    const name = fields[1].replace(/^\*/, '').replace(/^\.\//, '');
    if (name) sums.set(name, digest);
  }
  return sums;
}

const { dir, notes: notesPath, out } = options(process.argv.slice(2));
if (!dir || !notesPath || !out) {
  fail('usage: --dir <release files> --notes <notes.md> --out <manifest.json>');
}

const tag = process.env.RELEASE_TAG?.trim();
if (!tag || !STABLE_TAG.test(tag)) {
  fail(`RELEASE_TAG must be a stable SemVer tag, got: ${tag ?? '(unset)'}`);
}
const version = tag.slice(1);

const sums = parseChecksums(await readFile(join(dir, CHECKSUM_FILE), 'utf8'));
if (sums.size === 0) {
  fail(`${CHECKSUM_FILE} lists no digests`);
}

// The manifest is normally written into the directory it describes, so it has
// to be ignored here or a second run would trip the guard below on its own
// output.
const self = resolve(out) === resolve(dir, basename(out)) ? basename(out) : null;

const entries = await readdir(dir);
const files = {};
for (const name of entries.sort()) {
  if (name === CHECKSUM_FILE || name === self) continue;
  const match = ASSET.exec(name);
  if (!match) {
    // Anything else in this directory would be published as a release asset
    // without being named in the manifest, which is how a platform silently
    // loses its package.
    fail(`unexpected file in ${dir}: ${name}`);
  }
  if (match[1] !== version) {
    fail(`${name} is not version ${version}`);
  }
  const digest = sums.get(name);
  if (!digest) {
    fail(`${name} is not listed in ${CHECKSUM_FILE}`);
  }
  files[name] = {
    // Relative on purpose: the URL is the mirror's base joined to this, which
    // is what lets one manifest describe every mirror. It matches GitHub's own
    // releases/download/<tag>/<file> layout so both need no special case.
    path: `${tag}/${name}`,
    size: (await stat(join(dir, name))).size,
    sha256: digest,
  };
}

const missing = [...sums.keys()].filter((name) => !(name in files));
if (missing.length > 0) {
  fail(`${CHECKSUM_FILE} names files that were not packaged: ${missing.join(', ')}`);
}

const manifest = {
  schema: SCHEMA,
  version,
  tag,
  publishedAt: new Date().toISOString(),
  releaseURL: `${REPOSITORY}/releases/tag/${tag}`,
  notes: (await readFile(notesPath, 'utf8')).trim(),
  mirrors: MIRRORS,
  checksums: `${tag}/${CHECKSUM_FILE}`,
  files,
  // Reserved for the ed25519 signature over this object with the field
  // removed. Empty means unsigned, which clients accept for now.
  signature: '',
};

await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stderr.write(`[build-manifest] wrote ${tag} with ${Object.keys(files).length} packages\n`);
