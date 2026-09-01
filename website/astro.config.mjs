// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import { hastDocLinks } from './src/lib/hast-doc-links.mjs';
import { hastWrapTables } from './src/lib/hast-wrap-tables.mjs';

// Feeds canonical URLs, hreflang and the sitemap. A wrong value here ships
// wrong <link rel="canonical"> tags rather than failing the build, so it has to
// match what the site is actually served from.
const SITE = 'https://mq-studio.amigoer.com';

export default defineConfig({
  site: SITE,
  // zh is the default locale and stays unprefixed at `/`; English lives at `/en/`.
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  markdown: {
    // Sätteri is the default processor in Astro 7; naming it explicitly is what
    // lets the link rewriter run as a hast plugin.
    processor: satteri({
      // The docs link to sibling .md files for GitHub's benefit; this points
      // them at the rendered pages, or at the file on GitHub when the site
      // does not carry it.
      hastPlugins: [hastDocLinks, hastWrapTables],
    }),
    shikiConfig: {
      // Both themes are emitted at once and swapped by CSS, so highlighted
      // code follows the site's own light/dark toggle with no extra JS.
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: false,
    },
  },
  integrations: [
    sitemap({
      // /changelog/ and /en/changelog/ render the newest release and point
      // their canonical at that release's own page, so submitting them would
      // offer search engines a URL the page itself does not claim.
      filter: (page) => !/\/changelog\/$/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // The screenshots stay where the README already points at them; importing
        // them through this alias lets astro:assets optimise the originals with
        // no copy step and therefore no chance of the two drifting apart.
        '@shots': fileURLToPath(new URL('../docs/images/readme', import.meta.url)),
        '@brand': fileURLToPath(new URL('../build', import.meta.url)),
        // The changelog page parses the repo's own CHANGELOG files, so they
        // stay the single source of truth rather than being copied here.
        '@repo': fileURLToPath(new URL('..', import.meta.url)),
      },
    },
  },
});
