import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Chip({
  children,
  icon,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11.5px] text-(--c-fg-2)">
      {icon}
      <span className="truncate">{children}</span>
      {onRemove != null && (
        <button
          type="button"
          aria-label={removeLabel}
          className="-mr-0.5 rounded text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          className="size-7 text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
