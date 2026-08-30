import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * lucide draws on a 24 grid and inks about 20 of it, so 17px puts these within
 * a pixel of the 14px the GitHub mark fills solid, and a stroked set beside a
 * filled brand mark reads as one row. Expressed in rem (17/13) so the cluster
 * follows the font-size setting, and carrying `size-` so the Button's own
 * icon sizing rule leaves it alone.
 */
export const ICON_CLASS = "size-[1.3rem]";

/**
 * A 26px ghost icon button in the title bar cluster.
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
        "flex-none text-foreground/80",
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
