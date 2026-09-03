/*
 * Where a release is published, in the order a client should prefer.
 *
 * The list itself is mirrors.json rather than literals here, so that Go can
 * read the same bytes: TestBootstrapMirrorsMatchTheReleaseTooling compares it
 * against BootstrapMirrors in internal/update/mirror.go, which is the copy
 * compiled into the app. Three places name these hosts - the app, the manifest
 * every release carries, and the website's download links - and a release that
 * points somewhere the app does not look is not a recoverable mistake.
 *
 * Adding a mirror is a change to mirrors.json and nothing else: clients merge
 * the list they read from a manifest into the one they shipped with, so a
 * mirror added now reaches builds released before it existed.
 */
import { readFileSync } from 'node:fs';

export const REPOSITORY = 'https://github.com/amigoer/mq-studio';

export const MIRRORS = JSON.parse(readFileSync(new URL('./mirrors.json', import.meta.url), 'utf8'));
