import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ErrorBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "m-4 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-destructive",
        className,
      )}
      role="alert"
    >
      <AlertCircle size={14} className="shrink-0" />
      <span className="min-w-0 text-fs-12 leading-snug">{message}</span>
    </div>
  );
}
