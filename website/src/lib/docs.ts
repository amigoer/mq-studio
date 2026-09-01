import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '@/i18n';

interface Source {
  /** Id the glob loader assigns: the filename lowercased with dots dropped. */
  id: string;
  /** Real filename under docs/, for the "edit on GitHub" link. */
  file: string;
}

/**
 * Site slug -> the file that holds it in each language. `zh: null` means the
 * doc has no Chinese translation yet; the Chinese route still renders, showing
 * the English text behind a notice, so the language switch never dead-ends.
 */
const SOURCES = {
  install: {
    en: { id: 'install', file: 'INSTALL.md' },
    zh: { id: 'installzh-cn', file: 'INSTALL.zh-CN.md' },
  },
  architecture: {
    en: { id: 'architecture', file: 'ARCHITECTURE.md' },
    zh: null,
  },
  roadmap: {
    en: { id: 'roadmap', file: 'ROADMAP.md' },
    zh: { id: 'roadmapzh-cn', file: 'ROADMAP.zh-CN.md' },
  },
} as const satisfies Record<string, { en: Source; zh: Source | null }>;

export type DocSlug = keyof typeof SOURCES;

/** Order of the sidebar; also the order pages are generated in. */
export const DOC_SLUGS = Object.keys(SOURCES) as DocSlug[];

export interface ResolvedDoc {
  slug: DocSlug;
  entry: CollectionEntry<'docs'>;
  /** Path under docs/ of the file actually rendered. */
  file: string;
  /** True when this locale has no translation and is reading the English file. */
  untranslated: boolean;
}

export async function resolveDoc(slug: DocSlug, locale: Locale): Promise<ResolvedDoc> {
  const sources = SOURCES[slug];
  const wanted: Source | null = locale === 'zh' ? sources.zh : sources.en;
  const source = wanted ?? sources.en;

  const all = await getCollection('docs');
  const entry = all.find((candidate) => candidate.id === source.id);
  if (!entry) {
    // Loud rather than an empty page: the ids come from the loader's own
    // slugifying, which is not part of any API contract.
    throw new Error(
      `docs collection has no entry "${source.id}" for ${slug}/${locale}. ` +
        `Available: ${all.map((e) => e.id).join(', ')}. Check src/content.config.ts.`,
    );
  }

  return { slug, entry, file: source.file, untranslated: wanted === null };
}
