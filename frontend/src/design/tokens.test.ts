import { describe, expect, it } from "vitest";

/**
 * Every custom property the sources read, defined somewhere.
 *
 * A var() naming a property nobody set throws nothing and fails no type check:
 * the declaration is dropped at computed-value time and the element quietly
 * takes another value. Error text written as `var(--c-danger)` rendered in its
 * parent's colour, a meter's alarm fill as transparent, a separator as no line
 * at all - across thirty call sites, none of which looked wrong in the source.
 *
 * keys.test.ts is the same check for i18n keys, and this follows it: read the
 * sources, take every name written as a literal, and look it up. A name built
 * from a template is skipped rather than guessed at.
 */
const scripts = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/*
 * The stylesheets come off the disk, not through an import. Vitest swaps every
 * stylesheet import for an empty string, `?raw` included, which had this test
 * comparing against no definitions at all. The specifier is a variable because
 * the app's tsconfig carries no node types, and a test should not be what adds
 * them to every file it checks.
 */
const NODE_FS = "node:fs";
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync(path: URL, encoding: "utf8"): string;
  readdirSync(path: URL, options: { recursive: true }): string[];
};
const SRC = new URL("../", import.meta.url);
const stylesheets: Record<string, string> = Object.fromEntries(
  readdirSync(SRC, { recursive: true })
    .filter((name) => name.endsWith(".css"))
    .map((name) => [name, readFileSync(new URL(name, SRC), "utf8")]),
);

const DEFINED_IN_CSS = /(--[a-zA-Z][\w-]*)\s*:/g;
// Set from script: style.setProperty("--x", ...) or a style object's "--x" key.
const DEFINED_IN_SCRIPT = /(?:setProperty\(\s*|[{,]\s*)["'](--[a-zA-Z][\w-]*)["']/g;

// What follows the name tells a bare read from a template or a fallback.
const READ_BY_VAR = /var\(\s*(--[a-zA-Z][\w-]*)(\$\{)?\s*(,)?/g;
// Tailwind's shorthand: border-(--c-border), text-(--c-err).
const READ_BY_UTILITY = /[\w\]]-\((--[a-zA-Z][\w-]*)\)/g;

/** Set by a library at runtime, so never defined in these sources. */
const EXTERNAL = [/^--radix-/, /^--tw-/, /^--spacing$/];

/** Prose names tokens too, and `--c-series-N` in a comment is not a read. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function definedNames(): Set<string> {
  const names = new Set<string>();
  for (const [pattern, files] of [
    [DEFINED_IN_CSS, stylesheets],
    [DEFINED_IN_SCRIPT, scripts],
  ] as const) {
    for (const source of Object.values(files)) {
      for (const match of source.matchAll(pattern)) {
        if (match[1] != null) names.add(match[1]);
      }
    }
  }
  return names;
}

function reads(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const [file, raw] of Object.entries({ ...scripts, ...stylesheets })) {
    if (file.includes(".test.")) continue;
    const source = withoutComments(raw);
    for (const match of source.matchAll(READ_BY_VAR)) {
      const [, name, template, fallback] = match;
      // `--c-${tone}-text` is only half a name. A fallback is the author saying
      // the property may be unset.
      if (name == null || template != null || fallback != null) continue;
      out.push({ file, name });
    }
    for (const match of source.matchAll(READ_BY_UTILITY)) {
      if (match[1] != null) out.push({ file, name: match[1] });
    }
  }
  return out.filter(({ name }) => !EXTERNAL.some((rule) => rule.test(name)));
}

describe("custom properties", () => {
  it("are defined wherever the sources read them by name", () => {
    const defined = definedNames();
    const missing = reads()
      .filter(({ name }) => !defined.has(name))
      .map(({ file, name }) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });

  it("are read often enough that this test is doing something", () => {
    // A glob that silently matched nothing would pass the check above by
    // having nothing to check.
    expect(definedNames().size).toBeGreaterThan(100);
    expect(reads().length).toBeGreaterThan(1000);
  });
});
