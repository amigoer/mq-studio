import { zh } from './zh';
import { en } from './en';
import type { Content } from './types';

export type Locale = 'zh' | 'en';

export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALES: readonly Locale[] = ['zh', 'en'];

const content: Record<Locale, Content> = { zh, en };

export function t(locale: Locale): Content {
  return content[locale];
}

/** zh is the default locale and stays unprefixed; en lives under /en/. */
export function localePath(locale: Locale, path = ''): string {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  const prefix = locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
  return clean ? `${prefix}${clean}/` : prefix;
}

/**
 * Strips the locale prefix off a pathname, leaving the page's own path.
 * `/en/changelog/v0.0.3/` -> `changelog/v0.0.3`, `/` -> ``.
 */
export function stripLocale(pathname: string): string {
  const withoutLocale = pathname.replace(/^\/en(?=\/|$)/, '');
  return withoutLocale.replace(/^\//, '').replace(/\/$/, '');
}

/**
 * The same page in the other language. Every route is generated for both
 * locales, so this always resolves - switching language must not throw the
 * reader back to the home page.
 */
export function switchLocale(pathname: string, target: Locale): string {
  return localePath(target, stripLocale(pathname));
}

/** BCP 47 tags for <link rel="alternate" hreflang>. */
export const HREFLANG: Record<Locale, string> = { zh: 'zh-Hans', en: 'en' };

export type { Content, ModuleTab, NavLink } from './types';
