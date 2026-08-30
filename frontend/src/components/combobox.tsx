import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterOptions } from "@/lib/optionFilter";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label?: ReactNode };

/**
 * Searchable picker for broker-derived lists — topics, groups, queues — where
 * a plain dropdown stops working somewhere around a few dozen entries.
 *
 * Filtering is ours rather than cmdk's: a cluster with thousands of topics
 * must not put thousands of nodes in the popover, so the list is ranked and
 * capped here and the count that did not fit is reported. Capping before the
 * search would make anything past the cap unfindable.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  prefix,
  moreText,
  disabled,
  className,
  contentClassName,
}: {
  value: string;
  onValueChange?: (value: string) => void;
  options: readonly (ComboboxOption | string)[];
  /** Trigger text while nothing is picked. */
  placeholder?: ReactNode;
  searchPlaceholder?: string;
  emptyText?: ReactNode;
  /** Drawn inside the pill before the value, e.g. `Topic：`. */
  prefix?: ReactNode;
  /** Rendered when the search matched more than the popover will draw. */
  moreText?: (hidden: number) => ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: undefined } : option,
  );
  const current = normalized.find((option) => option.value === value);
  const byValue = new Map(normalized.map((option) => [option.value, option]));
  const filtered = filterOptions(normalized.map((option) => option.value), query);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-0.5">
            {value === "" ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {prefix != null && <span className="text-muted-foreground">{prefix}</span>}
                <span className="truncate">{current?.label ?? value}</span>
              </>
            )}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-(--radix-popover-trigger-width) min-w-56 p-0", contentClassName)}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.items.map((optionValue) => (
                <CommandItem
                  key={optionValue}
                  value={optionValue}
                  onSelect={() => {
                    onValueChange?.(optionValue);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate">
                    {byValue.get(optionValue)?.label ?? optionValue}
                  </span>
                  <Check
                    className={cn("ml-auto", optionValue === value ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {filtered.hidden > 0 && (
              <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                {moreText?.(filtered.hidden)}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
