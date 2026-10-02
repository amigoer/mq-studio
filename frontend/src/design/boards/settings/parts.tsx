import type { ReactNode } from "react";
import { SectionLabel } from "@/components";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** An uppercase heading over one card, the shape every panel below is built from. */
export function Group({
  title,
  first,
  action,
  children,
}: {
  title: ReactNode;
  first?: boolean;
  /** Drawn at the right of the heading, for what adds to the card below. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: first ? 0 : "26px" }}>
      <SectionLabel style={{ marginBottom: "10px" }} action={action} actionColor="var(--c-fg-2)">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

export type Option<T> = {
  value: T;
  label: string;
  /** Drawn before the label, in the trigger as well as in the menu. */
  mark?: ReactNode;
  /** A second line under the label, for what the option cannot say itself. */
  note?: string;
};

/** The settings dropdown: shadcn Select with a mark and an optional note. */
export function Dropdown<T extends string | number>({
  value,
  options,
  width = 200,
  onChange,
  triggerLabel,
}: {
  value: T;
  options: readonly Option<T>[];
  width?: number;
  onChange: (next: T) => void;
  /** Overrides the trigger text where it differs from the option's label. */
  triggerLabel?: ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        const picked = options.find((o) => String(o.value) === next);
        if (picked != null) onChange(picked.value);
      }}
    >
      {/*
       * The label has to be a SelectValue rather than a plain span: Radix
       * measures that node to line an item-aligned menu up with the trigger,
       * and with nothing to measure it leaves the menu at the window's corner.
       */}
      <SelectTrigger
        style={{ width: `${width}px` }}
        className="justify-between *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:gap-1.5"
      >
        <SelectValue>
          {current?.mark}
          <span className="truncate">{triggerLabel ?? current?.label ?? String(value)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent style={{ minWidth: `${width}px` }}>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              <span className="flex min-w-0 items-center gap-1.5">
                {o.mark}
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.note != null && (
                    <span className="block text-(length:--set-meta) text-muted-foreground">
                      {o.note}
                    </span>
                  )}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
