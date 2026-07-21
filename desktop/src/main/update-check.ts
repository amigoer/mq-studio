import type { UpdateCheckResult, UpdateStatus } from '../shared/bridge'

export const GITHUB_RELEASES_URL = 'https://github.com/amigoer/rocket-leaf/releases/latest'

const GITHUB_LATEST_RELEASE_API =
  'https://api.github.com/repos/amigoer/rocket-leaf/releases/latest'
const REQUEST_TIMEOUT_MS = 10_000
const STABLE_SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

interface ReleaseResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

interface ReleaseRequestOptions {
  headers: Record<string, string>
  signal: AbortSignal
}

export type ReleaseFetcher = (
  url: string,
  options: ReleaseRequestOptions,
) => Promise<ReleaseResponse>

interface StableVersion {
  normalized: string
  parts: readonly [bigint, bigint, bigint]
}

function parseStableVersion(value: string): StableVersion {
  const match = STABLE_SEMVER.exec(value.trim())
  if (!match) throw new Error(`invalid stable SemVer: ${value}`)

  const major = match[1]!
  const minor = match[2]!
  const patch = match[3]!
  return {
    normalized: `${major}.${minor}.${patch}`,
    parts: [BigInt(major), BigInt(minor), BigInt(patch)],
  }
}

export function compareStableVersions(left: string, right: string): -1 | 0 | 1 {
  const leftVersion = parseStableVersion(left)
  const rightVersion = parseStableVersion(right)

  for (let index = 0; index < leftVersion.parts.length; index += 1) {
    const leftPart = leftVersion.parts[index]!
    const rightPart = rightVersion.parts[index]!
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }
  return 0
}

function statusFromComparison(comparison: -1 | 0 | 1): UpdateStatus {
  if (comparison < 0) return 'available'
  if (comparison > 0) return 'ahead'
  return 'current'
}

const defaultFetcher: ReleaseFetcher = (url, options) => fetch(url, options)

export async function checkLatestRelease(
  currentVersion: string,
  fetcher: ReleaseFetcher = defaultFetcher,
): Promise<UpdateCheckResult> {
  const current = parseStableVersion(currentVersion)
  const response = await fetcher(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Rocket-Leaf/${current.normalized}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GitHub latest release request failed (${response.status})`)
  }

  const payload = await response.json()
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('tag_name' in payload) ||
    typeof payload.tag_name !== 'string'
  ) {
    throw new Error('GitHub latest release response is missing tag_name')
  }
  if (
    ('draft' in payload && payload.draft === true) ||
    ('prerelease' in payload && payload.prerelease === true)
  ) {
    throw new Error('GitHub latest release response is not a stable release')
  }

  const latest = parseStableVersion(payload.tag_name)
  return {
    status: statusFromComparison(compareStableVersions(current.normalized, latest.normalized)),
    currentVersion: current.normalized,
    latestVersion: latest.normalized,
  }
}
