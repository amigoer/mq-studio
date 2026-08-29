import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** `.in3` as a real text input. */
export const Field = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type ?? "text"} className={cn("in3", className)} {...props} />
));
Field.displayName = "Field";

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("in3", className)} {...props} />
));
TextArea.displayName = "TextArea";

/**
 * `.in3` rendered as a button — the canvas draws every dropdown as a bordered
 * pill with its own caret, so a native select would not match.
 */
export const SelectField = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: React.ReactNode }
>(({ className, value, ...props }, ref) => (
  <button ref={ref} type="button" className={cn("in3", "mqs-select", className)} {...props}>
    {value}
    <ChevronDown size={13} aria-hidden />
  </button>
));
SelectField.displayName = "SelectField";

/** A labelled field group (`.fld`). */
export function FieldGroup({
  label,
  children,
  className,
  style,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <label className={cn("fld", className)} style={style}>
      <span>{label}</span>
      {children}
    </label>
  );
}
