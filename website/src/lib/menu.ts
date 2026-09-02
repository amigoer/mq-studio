import type { Content } from '@/i18n/types';
import { formatSize, linux, mac, windows, type ReleaseFile } from './downloads';

export interface DownloadRow {
  label: string;
  file: string;
  href: string;
  /** Already formatted: the menu is markup, not a script. */
  size: string;
}

const row = (label: string, file: ReleaseFile): DownloadRow => ({
  label,
  file: file.name,
  href: file.url,
  size: formatSize(file.size),
});

export interface DownloadGroup {
  name: string;
  platform: 'mac' | 'windows' | 'linux';
  rows: DownloadRow[];
}

/** The platform list shared by the nav menu and the hero split button. */
export function downloadGroups(c: Content): DownloadGroup[] {
  const p = c.download.platforms;
  const a = c.download.archLabels;
  return [
    {
      name: p.mac.name,
      platform: 'mac',
      rows: [row(a.arm64, mac('arm64')), row(a.amd64, mac('amd64'))],
    },
    {
      name: p.windows.name,
      platform: 'windows',
      rows: [row(a.winAmd64, windows('amd64')), row(a.winArm64, windows('arm64'))],
    },
    {
      name: p.linux.name,
      platform: 'linux',
      rows: [
        row(`.deb · ${a.winAmd64}`, linux('amd64', 'deb')),
        row(`.rpm · ${a.winAmd64}`, linux('amd64', 'rpm')),
        row(`AppImage · ${a.winAmd64}`, linux('amd64', 'AppImage')),
      ],
    },
  ];
}
