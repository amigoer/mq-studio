/**
 * The app icon from build/appicon.svg, with the viewBox cropped to its red tile
 * so `size` is the tile's edge.
 */
export function AppLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" style={{ flex: "none" }} aria-hidden>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#ec3013" />
      <g transform="translate(182 182) scale(6.6)">
        <path
          fill="#f3f2f2"
          d="M50 14A36 36 0 0 1 74.9 24H25.1A36 36 0 0 1 50 14ZM20.407 29.5H79.593A36 36 0 0 1 84.435 39.5H15.565A36 36 0 0 1 20.407 29.5ZM15.565 60.5H84.435A36 36 0 0 1 79.593 70.5H20.407A36 36 0 0 1 15.565 60.5ZM25.1 76H74.9A36 36 0 0 1 50 86A36 36 0 0 1 25.1 76ZM14.349 45H28A5 5 0 0 1 28 55H14.349A36 36 0 0 1 14.349 45ZM72 45H85.651A36 36 0 0 1 85.651 55H72A5 5 0 0 1 72 45Z"
        />
        <rect x="39" y="45" width="22" height="10" rx="5" fill="#201e1d" />
      </g>
    </svg>
  );
}
