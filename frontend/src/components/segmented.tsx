import type * as React from "react";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type SegOption<T extends string> = { value: T; label: ReactNode };

/**
 * The small segmented value switcher (时间范围, 视图切换…): shadcn Tabs used
 * without panels, active segment inverted the way the app draws it.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  block,
  tone = "solid",
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
  /** `soft` is for a form: a grey track as tall as an input, the chosen
      segment raised off it. The inverted `solid` one is as loud as a primary
      button, and a form already has one of those. */
  tone?: "solid" | "soft";
  className?: string;
  style?: React.CSSProperties;
}) {
  const soft = tone === "soft";
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange?.(next as T)}
      className={className}
      style={style}
    >
      <TabsList
        className={cn(
          soft ? "gap-0.5 bg-(--c-fill)" : "h-auto gap-0.5 border bg-background p-0.5",
          block && "w-full",
        )}
      >
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className={cn(
              "rounded-md border-0 px-2.5 text-xs font-normal",
              block && "flex-1",
              soft
                ? // The dark chip is lighter than its track, where the light one is
                  // whiter: raised reads as brighter on either ground.
                  "text-(--c-fg-2) data-[state=active]:font-medium dark:data-[state=active]:bg-(--c-border-strong)"
                : "py-[3px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none",
            )}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
