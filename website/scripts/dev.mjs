#!/usr/bin/env node
/*
 * Builds the site, serves website/dist on PORT (4321 by default), and builds
 * again when the theme, the site configs, the docs or the changelogs change.
 * The two languages are only whole once merged, so this serves the merged
 * output rather than running `kite serve` on either half.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(WEBSITE);
const DIST = join(WEBSITE, 'dist');
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

let building = null;
let again = false;
function build() {
  if (building) {
    again = true;
    return building;
  }
  building = new Promise((resolve) => {
    const child = spawn(process.execPath, [join(WEBSITE, 'scripts', 'build.mjs')], { stdio: 'inherit' });
    child.on('exit', () => {
      building = null;
      if (again) {
        again = false;
        build();
      }
      resolve();
    });
  });
  return building;
}

async function resolveFile(path) {
  const file = normalize(join(DIST, decodeURIComponent(path.split('?')[0])));
  if (!file.startsWith(DIST)) return null;
  try {
    const info = await stat(file);
    return info.isDirectory() ? join(file, 'index.html') : file;
  } catch {
    return null;
  }
}

await build();

createServer(async (request, response) => {
  await building;
  const file = await resolveFile(request.url ?? '/');
  try {
    if (!file) throw new Error('missing');
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    const english = (request.url ?? '').startsWith('/en/');
    const page = await readFile(join(DIST, english ? 'en/404.html' : '404.html')).catch(() => 'Not found');
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  }
}).listen(PORT, () => process.stderr.write(`[website] serving http://localhost:${PORT}\n`));

let timer = 0;
const rebuild = () => {
  clearTimeout(timer);
  timer = setTimeout(build, 150);
};
for (const dir of ['themes', 'sites', 'static', 'scripts', 'data']) watch(join(WEBSITE, dir), { recursive: true }, rebuild);
watch(join(REPO, 'docs'), { recursive: true }, rebuild);
for (const file of ['CHANGELOG.md', 'CHANGELOG.zh-CN.md']) watch(join(REPO, file), rebuild);
