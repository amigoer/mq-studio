import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 border-b border-border/80 bg-background px-5 pb-3.5 pt-4",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-fs-15 font-semibold tracking-tight text-foreground">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 text-fs-12 leading-snug text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
