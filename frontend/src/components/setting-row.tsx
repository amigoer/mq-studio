import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A settings row: label and hint on the left, controls on the right. The last
 * row of a card drops its rule so the card's own border is the only line
 * under it. Sizes ride the `--set-*` scale the settings page defines.
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
    <div
      data-slot="setting-row"
      className={cn(
        "flex items-center gap-3 border-b border-(--c-rule) px-4 py-[11px] text-[12.5px]",
        last && "border-b-0",
      )}
      style={style}
    >
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        {hint != null && (
          <div data-slot="setting-row-hint" className="mt-px text-xs text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}
