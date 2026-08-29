/**
 * The wordmark glyph drawn in the canvas title bar (140x96 viewBox). The ink
 * fills about 60% of that box vertically, so the default is sized for the mark
 * to read against the 26px icon buttons rather than for the box to match them.
 */
export function AppLogo({ width = 32, height = 22 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 140 96" style={{ flex: "none" }} aria-hidden>
      <path
        d="M12 74 V26 L34 55 L56 26 V74"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        stroke="#201e1d"
        strokeWidth="10"
      />
      <circle cx="98" cy="50" r="24" fill="none" stroke="#201e1d" strokeWidth="10" />
      <line x1="109" y1="63" x2="120" y2="74" stroke="#ec3013" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}
