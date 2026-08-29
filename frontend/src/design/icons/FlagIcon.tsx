import type { JSX } from "react";
import type { SupportedLanguage } from "@/i18n";

/*
 * The marks beside 界面语言. Drawn rather than pulled from a flag pack: the two
 * the picker needs are two SVGs, and the emoji flags they would otherwise be
 * do not render on Windows at all.
 *
 * A flag names a country and a language does not, so these stand for the
 * locales the app ships -- 简体中文 for zh-CN, and the Union Flag for English,
 * the language's own rather than any one of the countries that speak it.
 */

const CN = (
  <>
    <rect width="20" height="14" fill="#ee1c25" />
    <g fill="#ff0">
      <path d="M3.33 1.45L3.79 2.87L5.28 2.87L4.08 3.74L4.54 5.16L3.33 4.28L2.13 5.16L2.59 3.74L1.38 2.87L2.87 2.87Z" />
      <path d="M6.09 1.76L6.41 1.38L6.14 0.96L6.60 1.15L6.92 0.77L6.89 1.26L7.35 1.45L6.87 1.57L6.83 2.06L6.57 1.64Z" />
      <path d="M7.32 2.90L7.77 2.68L7.69 2.19L8.04 2.54L8.49 2.32L8.26 2.76L8.61 3.12L8.12 3.03L7.89 3.47L7.81 2.98Z" />
      <path d="M7.35 4.70L7.84 4.69L7.98 4.22L8.15 4.69L8.64 4.67L8.25 4.98L8.41 5.44L8.01 5.16L7.61 5.46L7.75 4.99Z" />
      <path d="M6.14 5.86L6.60 6.05L6.92 5.67L6.89 6.16L7.35 6.35L6.87 6.47L6.83 6.96L6.57 6.54L6.09 6.66L6.41 6.28Z" />
    </g>
  </>
);

const GB = (
  <>
    <rect width="20" height="14" fill="#012169" />
    <path d="M0 0l20 14M20 0L0 14" stroke="#fff" strokeWidth="2.8" />
    <path d="M0 0l20 14M20 0L0 14" stroke="#c8102e" strokeWidth="1.6" />
    <path d="M10 0v14M0 7h20" stroke="#fff" strokeWidth="4.6" />
    <path d="M10 0v14M0 7h20" stroke="#c8102e" strokeWidth="2.8" />
  </>
);

const FLAGS: Record<SupportedLanguage, JSX.Element> = { zh: CN, en: GB };

/** 20x14 at the drawn scale, the proportion both flags are specified at. */
export function FlagIcon({ lang, size = 15 }: { lang: SupportedLanguage; size?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 14"
      width={size}
      height={(size * 14) / 20}
      aria-hidden
      style={{
        flex: "none",
        borderRadius: "2px",
        // The pale edge keeps the white in either flag off a white row.
        boxShadow: "inset 0 0 0 0.5px rgba(0, 0, 0, 0.18)",
      }}
    >
      {FLAGS[lang]}
    </svg>
  );
}
