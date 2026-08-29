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
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label?: ReactNode };

/**
 * Searchable picker for broker-derived lists — topics, groups, queues — where
 * a plain dropdown stops working somewhere around a few dozen entries.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  prefix,
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
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: undefined } : option,
  );
  const current = normalized.find((option) => option.value === value);

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
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {normalized.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onValueChange?.(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label ?? option.value}</span>
                  <Check
                    className={cn("ml-auto", option.value === value ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
