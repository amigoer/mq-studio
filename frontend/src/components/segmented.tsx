import type * as React from "react";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SegOption<T extends string> = { value: T; label: ReactNode };

/**
 * The small segmented value switcher (时间范围, 视图切换…): shadcn Tabs used
 * without panels, active segment inverted the way the app draws it.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  block,
  className,
  style,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  /** Fill the width it is given, segments sharing it evenly, instead of
      hugging the labels. For form rows, where a hugging control leaves the
      rest of the line blank. */
  block?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange?.(next as T)}
      className={className}
      style={style}
    >
      <TabsList className={cn("h-auto gap-0.5 border bg-background p-0.5", block && "w-full")}>
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className={cn(
              "rounded-md border-0 px-2.5 py-[3px] text-xs font-normal",
              block && "flex-1",
              "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none",
            )}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
