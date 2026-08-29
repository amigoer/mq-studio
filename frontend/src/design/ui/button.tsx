import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** `.btn3` from the canvas: default, `.pri` (solid) and `.dgr` (destructive). */
const btnVariants = cva("btn3", {
  variants: {
    variant: {
      default: "",
      primary: "pri",
      danger: "dgr",
    },
    /** `row` is the compact in-row action button used in the 8a table. */
    size: {
      default: "",
      row: "mqs-btn-row",
      rowIcon: "mqs-btn-row mqs-btn-rowicon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface BtnProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof btnVariants> {
  asChild?: boolean;
}

export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(btnVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Btn.displayName = "Btn";

/** `.tbi` — the 26x26 square icon button in the title bar. */
export const IconBtn = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active, type, ...props }, ref) => (
  <button
    ref={ref}
    type={type ?? "button"}
    aria-pressed={active}
    className={cn("tbi", active && "on", className)}
    {...props}
  />
));
IconBtn.displayName = "IconBtn";

export { btnVariants };
