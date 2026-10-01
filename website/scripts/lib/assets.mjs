/*
 * Pictures the site serves, made from the README's own screenshots so the
 * two never drift: each one at a few widths as WebP for srcset, and the
 * picture shown when a page is shared.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** The README captures are all 1280x800 framed to this size. */
export const SHOT = { width: 2052, height: 1332, widths: [640, 1280, 2052] };

export const SHOTS = [
  'overview', 'overview.dark', 'overview.en', 'overview.en.dark',
  'assistant', 'assistant.en',
  'connections', 'connections.en', 'topics', 'topics.en', 'consumers', 'consumers.en',
  'messages', 'messages.en', 'cluster', 'alerts',
];

async function newer(output, input) {
  try {
    return (await stat(output)).mtimeMs >= (await stat(input)).mtimeMs;
  } catch {
    return false;
  }
}

export async function renderShots(sourceDir, outDir) {
  const dir = join(outDir, 'shots');
  await mkdir(dir, { recursive: true });
  const jobs = [];
  for (const name of SHOTS) {
    const source = join(sourceDir, `${name}.png`);
    for (const width of SHOT.widths) {
      const output = join(dir, `${name}-${width}.webp`);
      jobs.push(
        newer(output, source).then((fresh) =>
          fresh ? null : sharp(source).resize({ width }).webp({ quality: 82, effort: 5 }).toFile(output),
        ),
      );
    }
  }
  await Promise.all(jobs);
}

/** The picture a shared link shows, one per language. */
export async function renderShareImages(sourceDir, outDir) {
  await mkdir(join(outDir, 'images'), { recursive: true });
  for (const [name, file] of [['overview', 'og.jpg'], ['overview.en', 'og.en.jpg']]) {
    const source = join(sourceDir, `${name}.png`);
    const output = join(outDir, 'images', file);
    if (await newer(output, source)) continue;
    await sharp(source).resize({ width: 1200 }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toFile(output);
  }
}

export async function copyAvatars(sourceDir, outDir) {
  const dir = join(outDir, 'images', 'avatars');
  await mkdir(dir, { recursive: true });
  let files = [];
  try {
    files = await readdir(sourceDir);
  } catch {
    return;
  }
  for (const file of files) await copyFile(join(sourceDir, file), join(dir, file));
}
