import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * lucide draws on a 24 grid and inks about 20 of it, so 17px puts these within
 * a pixel of the 14px the GitHub mark fills solid, and a stroked set beside a
 * filled brand mark reads as one row. It carries `size-` so the Button's own
 * icon sizing rule leaves it alone.
 *
 * In px, not rem. This was `1.3rem`, written as 17/13 against BASE_FONT_SIZE --
 * but the scale ladder zooms the document rather than setting a root font size
 * (see useUIScale), so the root stays at the browser's 16 and that rem rendered
 * as 20.8px. Scaling with the setting is the one thing the rem was there to
 * buy, and `zoom` already provides it.
 */
export const ICON_CLASS = "size-[17px]";

/**
 * A 28px ghost icon button in the title bar cluster.
 *
 * 28 rather than shadcn's `icon-sm`, which is 32: the bar is 40px tall around
 * 30px tabs, and a 32px box stands taller than the tabs beside it, which is
 * what made the cluster read as the heaviest thing in the row.
 *
 * Lives here rather than in TitleBar because the bell is its own popover
 * trigger: the notification centre has to render this button itself, and
 * importing it back out of TitleBar would close a cycle.
 */
export function IconBtn({
  active,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={active}
      className={cn(
        // Overrides icon-sm's size-8; tailwind-merge keeps the later class.
        "size-7 flex-none text-foreground/80",
        active && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** The corner mark on an icon button. It sits over the glyph, so it needs an edge. */
export function Badge({ tone }: { tone: string }) {
  return (
    <span
      style={{
        position: "absolute",
        top: "3px",
        right: "3px",
        width: "6px",
        height: "6px",
        borderRadius: "99px",
        background: tone,
        boxShadow: "0 0 0 1.5px var(--c-bg)",
      }}
    />
  );
}
