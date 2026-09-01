import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/*
 * The repo's own docs are the source of truth; nothing is copied into the site.
 * Only the files the site actually links to are loaded - MULTI_MQ_* and
 * AUTO-UPDATE are internal notes and have no place on a marketing site.
 */
const docs = defineCollection({
  loader: glob({
    base: '../docs',
    pattern: [
      'INSTALL.md',
      'INSTALL.zh-CN.md',
      'ARCHITECTURE.md',
      'ROADMAP.md',
      'ROADMAP.zh-CN.md',
    ],
  }),
});

export const collections = { docs };
