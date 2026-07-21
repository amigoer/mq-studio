import { describe, expect, it, vi } from 'vitest'
import {
  checkLatestRelease,
  compareStableVersions,
  type ReleaseFetcher,
} from './update-check'

function releaseFetcher(payload: unknown, status = 200): ReleaseFetcher {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }))
}

describe('compareStableVersions', () => {
  it('compares major, minor, and patch components numerically', () => {
    expect(compareStableVersions('1.9.9', '1.10.0')).toBe(-1)
    expect(compareStableVersions('10.0.0', '2.99.99')).toBe(1)
    expect(compareStableVersions('v1.4.0', '1.4.0+build.7')).toBe(0)
  })

  it.each(['1.4', '1.4.0-beta.1', '01.4.0', 'latest'])(
    'rejects non-stable version %s',
    (version) => {
      expect(() => compareStableVersions(version, '1.4.0')).toThrow('invalid stable SemVer')
    },
  )
})

describe('checkLatestRelease', () => {
  it.each([
    ['1.4.0', 'v1.5.0', 'available'],
    ['1.4.0', 'v1.4.0', 'current'],
    ['2.0.0', 'v1.4.0', 'ahead'],
  ] as const)('returns %s against %s as %s', async (current, latest, status) => {
    await expect(
      checkLatestRelease(current, releaseFetcher({ tag_name: latest })),
    ).resolves.toEqual({
      status,
      currentVersion: current,
      latestVersion: latest.slice(1),
    })
  })

  it('rejects failed GitHub responses', async () => {
    await expect(checkLatestRelease('1.4.0', releaseFetcher({}, 403))).rejects.toThrow(
      'GitHub latest release request failed (403)',
    )
  })

  it('requests the GitHub latest release endpoint', async () => {
    const fetcher = releaseFetcher({ tag_name: 'v1.4.0' })
    await checkLatestRelease('1.4.0', fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/amigoer/rocket-leaf/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Rocket-Leaf/1.4.0',
        }),
      }),
    )
  })

  it('rejects prereleases and malformed payloads', async () => {
    await expect(
      checkLatestRelease(
        '1.4.0',
        releaseFetcher({ tag_name: 'v1.5.0-beta.1', prerelease: true }),
      ),
    ).rejects.toThrow('not a stable release')
    await expect(checkLatestRelease('1.4.0', releaseFetcher({ name: 'v1.5.0' }))).rejects.toThrow(
      'missing tag_name',
    )
  })
})
