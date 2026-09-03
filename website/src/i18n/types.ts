export interface NavLink {
  label: string;
  href: string;
}

export interface ModuleTab {
  /** Matches a screenshot basename in docs/images/readme. */
  id: 'connections' | 'topics' | 'consumers' | 'cluster' | 'alerts';
  label: string;
  title: string;
  desc: string;
  points: readonly string[];
  alt: string;
}

export interface Content {
  htmlLang: string;
  meta: { title: string; description: string; ogAlt: string };
  banner: { text: string; linkLabel: string; dismiss: string };
  nav: {
    features: string;
    modules: string;
    roadmap: string;
    docs: string;
    changelog: string;
    github: string;
    download: string;
    moreDownloads: string;
    skipToContent: string;
    home: string;
    breadcrumb: string;
    languageLabel: string;
    menu: string;
    theme: string;
  };
  hero: {
    badgeSuffix: string;
    title: string;
    subtitle: string;
    downloadFallback: string;
    downloadFor: (platform: string) => string;
    installGuide: string;
    note: string;
  };
  shot: { caption: string };
  drivers: { label: string; supported: readonly string[]; planned: string };
  features: {
    title: string;
    lead: string;
    items: readonly { title: string; body: string }[];
  };
  modules: { title: string; lead: string; tabs: readonly ModuleTab[] };
  roadmap: {
    title: string;
    body: string;
    linkLabel: string;
    stages: readonly { label: string; done: boolean }[];
  };
  changelog: {
    navLabel: string;
    title: string;
    lead: string;
    metaTitle: string;
    metaDescription: string;
    latest: string;
    onThisPage: string;
    inThisRelease: string;
    pagination: string;
    newer: string;
    older: string;
    onGitHub: string;
  };
  docs: {
    navLabel: string;
    sectionTitle: string;
    titles: Record<'install' | 'architecture' | 'roadmap', string>;
    untranslated: string;
    onThisPage: string;
    editOnGitHub: string;
  };
  community: {
    title: string;
    lead: string;
    stars: string;
    forks: string;
    contributors: string;
    license: string;
    builtBy: string;
    ctaIssues: string;
    ctaRepo: string;
  };
  download: {
    title: string;
    leadPrefix: string;
    leadSuffix: string;
    /** Link to the same file on the second mirror. */
    mirror: string;
    platforms: Record<'mac' | 'windows' | 'linux', { name: string; requirement: string; cta: string }>;
    archLabels: { amd64: string; arm64: string; winAmd64: string; winArm64: string };
    noteMac: string;
    noteMacLink: string;
    noteLinux: string;
    noteLinuxLink: string;
    selectArch: string;
    selectFormat: string;
  };
  footer: {
    tagline: string;
    copyright: string;
    groups: readonly { title: string; links: readonly NavLink[] }[];
  };
}
