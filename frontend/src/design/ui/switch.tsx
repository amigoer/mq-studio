import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** `.sw` — 28x16 track, green when on. */
export function Sw({
  checked = true,
  onCheckedChange,
  className,
  style,
  label,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn("sw", !checked && "off", className)}
      style={style}
    />
  );
}
