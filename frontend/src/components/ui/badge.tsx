import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Semantic variants carry a tinted fill *and* a matching hairline. Alerts and
 * Connections each grew their own inline-styled badge to get that border; both
 * are gone now, and every badge in the app comes from here.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-fs-11 font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-background text-foreground",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        destructive: "border-destructive/25 bg-destructive/10 text-destructive",
        info: "border-info/25 bg-info/10 text-info",
      },
      /** Small all-caps chip — alert levels, environment tags. */
      uppercase: {
        true: "px-1 text-fs-10 font-semibold uppercase tracking-[0.02em]",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, uppercase, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant, uppercase }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
