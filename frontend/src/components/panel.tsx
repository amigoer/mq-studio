import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A plain bordered surface: the shadcn Card without its stack layout. */
export function Panel({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("block gap-0 rounded-xl py-0 shadow-xs", className)} {...props} />;
}

/** The header row used by chart and table panels: title left, action right. */
export function PanelHeader({
  title,
  action,
  style,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center border-b px-4 py-[11px]", className)} style={style}>
      <b className="text-[12.5px] font-semibold">{title}</b>
      <span className="flex-1" />
      {action}
    </div>
  );
}
