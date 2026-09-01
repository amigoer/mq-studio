import type { Content } from '@/i18n/types';
import { linux, mac, windows } from './downloads';

export interface DownloadRow {
  label: string;
  file: string;
  href: string;
}

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
      rows: [
        { label: a.arm64, file: mac('arm64').name, href: mac('arm64').url },
        { label: a.amd64, file: mac('amd64').name, href: mac('amd64').url },
      ],
    },
    {
      name: p.windows.name,
      platform: 'windows',
      rows: [
        { label: a.winAmd64, file: windows('amd64').name, href: windows('amd64').url },
        { label: a.winArm64, file: windows('arm64').name, href: windows('arm64').url },
      ],
    },
    {
      name: p.linux.name,
      platform: 'linux',
      rows: [
        { label: `.deb · ${a.winAmd64}`, file: linux('amd64', 'deb').name, href: linux('amd64', 'deb').url },
        { label: `.rpm · ${a.winAmd64}`, file: linux('amd64', 'rpm').name, href: linux('amd64', 'rpm').url },
        {
          label: `AppImage · ${a.winAmd64}`,
          file: linux('amd64', 'AppImage').name,
          href: linux('amd64', 'AppImage').url,
        },
      ],
    },
  ];
}
