import type { CSSProperties, ReactNode } from "react";
import { Check as CheckIcon } from "lucide-react";

/** `.ph3` — the grey text-skeleton block. */
export function Placeholder({ width, style }: { width?: number | string; style?: CSSProperties }) {
  return <div className="ph3" style={{ width, ...style }} />;
}

/**
 * `.srow` — a settings row: label and hint on the left, controls on the right.
 * The last row of a card drops its rule so the card's own border is the only
 * line under it.
 */
export function SettingRow({
  label,
  hint,
  children,
  last,
  style,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  last?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="srow" style={last ? { borderBottom: "none", ...style } : style}>
      <div className="lab">
        <div>{label}</div>
        {hint != null && <div className="hint">{hint}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "none" }}>
        {children}
      </div>
    </div>
  );
}

/** The 12px square checkbox drawn in the 14c PEL table. */
export function Check({
  checked,
  onChange,
  label,
}: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={Boolean(checked)}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      style={
        checked
          ? {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "12px",
              height: "12px",
              borderRadius: "3px",
              background: "var(--c-fg)",
              color: "var(--c-bg)",
              border: "none",
              padding: 0,
            }
          : {
              display: "inline-block",
              width: "12px",
              height: "12px",
              border: "1.4px solid var(--c-disabled)",
              borderRadius: "3px",
              background: "transparent",
              padding: 0,
            }
      }
    >
      {checked && <CheckIcon size={9} strokeWidth={3} aria-hidden />}
    </button>
  );
}
