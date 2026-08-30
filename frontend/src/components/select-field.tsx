import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectFieldOption<T extends string = string> = {
  value: T;
  label?: ReactNode;
  disabled?: boolean;
};

/**
 * Options-driven wrapper over the shadcn Select, for the toolbar filter pills
 * and form dropdowns. Big broker-derived lists get `Combobox` instead.
 */
export function SelectField<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  prefix,
  disabled,
  size = "sm",
  className,
  contentClassName,
}: {
  value: T | "";
  onValueChange?: (value: T) => void;
  options: readonly SelectFieldOption<T>[];
  placeholder?: ReactNode;
  /** Drawn inside the pill before the value, e.g. `Topic：`. */
  prefix?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Select
      value={value === "" ? undefined : value}
      onValueChange={(next) => onValueChange?.(next as T)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("whitespace-nowrap", className)}>
        {prefix != null && <span className="text-muted-foreground">{prefix}</span>}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label ?? option.value}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
