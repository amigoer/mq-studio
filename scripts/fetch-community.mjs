#!/usr/bin/env node
/*
 * Writes website/src/data/community.json and downloads contributor avatars into
 * website/src/assets/avatars so the page makes no third-party request.
 *
 * Never fails the build: both the JSON and the avatars are committed, so an
 * offline or rate-limited build falls back to the last known-good copy.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'amigoer/mq-studio';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'website', 'src');
const OUT = join(ROOT, 'data', 'community.json');
const AVATARS = join(ROOT, 'assets', 'avatars');

const warn = (m) => process.stderr.write(`[fetch-community] ${m}\n`);

async function keepExisting(reason) {
  warn(`${reason}; keeping the committed community.json`);
  try {
    const existing = JSON.parse(await readFile(OUT, 'utf8'));
    warn(`fallback lists ${existing.contributors?.length ?? 0} contributor(s)`);
  } catch {
    warn('no committed community.json to fall back to');
  }
  process.exit(0);
}

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'mq-studio-website' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const get = async (path) => {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return response.json();
};

let repo;
let contributors;
try {
  [repo, contributors] = await Promise.all([get(''), get('/contributors?per_page=100')]);
} catch (error) {
  await keepExisting(error.message);
}

// Bots commit like people but are not contributors in the sense this section means.
const people = (Array.isArray(contributors) ? contributors : []).filter(
  (c) => c.type === 'User' && !/\[bot\]$/.test(c.login),
);

await mkdir(AVATARS, { recursive: true });

const saved = [];
for (const person of people) {
  const file = `${person.login}.png`;
  try {
    // s=160 covers the 80px slot at 2x; the raw avatar can be 460px.
    const response = await fetch(`${person.avatar_url}&s=160`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`avatar returned ${response.status}`);
    await writeFile(join(AVATARS, file), Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    // An avatar that will not download must not drop the person from the list;
    // the component falls back to their initial.
    warn(`could not fetch the avatar for ${person.login}: ${error.message}`);
  }
  saved.push({
    login: person.login,
    contributions: person.contributions,
    htmlUrl: person.html_url,
    avatar: file,
  });
}

const community = {
  stars: repo.stargazers_count ?? 0,
  forks: repo.forks_count ?? 0,
  openIssues: repo.open_issues_count ?? 0,
  watchers: repo.subscribers_count ?? 0,
  contributors: saved,
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(community, null, 2)}\n`);
warn(`wrote ${saved.length} contributor(s), ${community.stars} stars`);
