/*
 * What the templates read from site.params. Kite has no data files, so the
 * build writes these into each site's kite.yaml before it runs.
 */
export const RELEASES_URL = 'https://github.com/amigoer/mq-studio/releases';
const LATEST_URL = `${RELEASES_URL}/latest`;

const sizeLabel = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');

/**
 * Every package as the download section and the menus list it. A file the
 * release does not have points at the release page rather than nowhere.
 */
export function releaseParams(release) {
  const file = (key) => {
    const found = release.files?.[key];
    return found
      ? { name: found.name, url: found.url, alternate: found.alternate ?? '', size: sizeLabel(found.size) }
      : { name: '', url: LATEST_URL, alternate: '', size: '' };
  };
  const arches = ['amd64', 'arm64'];
  const formats = ['deb', 'rpm', 'AppImage'];
  return {
    tag: release.tag,
    version: release.version,
    url: release.htmlUrl ?? LATEST_URL,
    checksums: release.checksums ?? '',
    mac: { arm64: file('mac-arm64'), amd64: file('mac-amd64') },
    windows: { amd64: file('windows-amd64'), arm64: file('windows-arm64') },
    linux: Object.fromEntries(
      formats.map((format) => [format, Object.fromEntries(arches.map((arch) => [arch, file(`linux-${arch}-${format}`)]))]),
    ),
  };
}

export function communityParams(community) {
  return {
    stars: community.stars ?? 0,
    forks: community.forks ?? 0,
    contributors: (community.contributors ?? []).map((person) => ({
      login: person.login,
      url: person.htmlUrl,
      avatar: person.avatar ? `images/avatars/${person.avatar}` : '',
    })),
  };
}
