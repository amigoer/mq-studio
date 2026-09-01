import community from '@/data/community.json';

export interface Contributor {
  login: string;
  contributions: number;
  htmlUrl: string;
  avatar: string;
}

export const COMMUNITY = {
  stars: community.stars,
  forks: community.forks,
  openIssues: community.openIssues,
  watchers: community.watchers,
  contributors: community.contributors as Contributor[],
};

export const ISSUES_URL = 'https://github.com/amigoer/mq-studio/issues';

/** 1234 -> "1.2k"; the counts sit in a tight row and must not wrap. */
export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}
