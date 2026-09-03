import release from '@/data/release.json';

export type MacArch = 'arm64' | 'amd64';
export type WinArch = 'amd64' | 'arm64';
export type LinuxArch = 'amd64' | 'arm64';
export type LinuxFormat = 'deb' | 'rpm' | 'AppImage';

export interface ReleaseFile {
  name: string;
  url: string;
  /**
   * The same file on the next mirror, '' when the release named only one. The
   * site ships no JavaScript, so it cannot measure which mirror a visitor can
   * reach - offering both statically is the most it can honestly do.
   */
  alternate: string;
  size: number;
}

const files = release.files as Record<string, ReleaseFile | undefined>;

export const RELEASE = {
  tag: release.tag,
  version: release.version,
  htmlUrl: release.htmlUrl,
  checksums: release.checksums,
};

export const RELEASES_URL = 'https://github.com/amigoer/mq-studio/releases';
export const LATEST_URL = `${RELEASES_URL}/latest`;
export const REPO_URL = 'https://github.com/amigoer/mq-studio';

/**
 * Falls back to the releases page rather than a dead link when an expected
 * asset is missing - a partially published release must not strand the visitor.
 */
function pick(key: string): ReleaseFile {
  return files[key] ?? { name: '', url: LATEST_URL, alternate: '', size: 0 };
}

export const mac = (arch: MacArch) => pick(`mac-${arch}`);
export const windows = (arch: WinArch) => pick(`windows-${arch}`);
export const linux = (arch: LinuxArch, format: LinuxFormat) => pick(`linux-${arch}-${format}`);

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
