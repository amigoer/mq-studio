import type { CSSProperties, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The amber caution strip above a destructive tool (ack mode, redelivery…). */
export function WarnBanner({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <Alert
      className="mx-5 w-auto flex-none border-(--c-warn-border) bg-(--c-warn-bg-soft) px-3 py-2 text-(--c-warn-text-deep)"
      style={style}
    >
      <AlertDescription className="flex items-center gap-1.5 text-xs text-inherit">
        {children}
      </AlertDescription>
    </Alert>
  );
}
