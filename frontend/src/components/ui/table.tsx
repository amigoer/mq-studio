"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  inset,
  size,
  ...props
}: React.ComponentProps<"table"> & {
  inset?: boolean | "card"
  /** `compact` is the dense grid a detail sheet nests: partitions, queues, bindings. */
  size?: "compact"
}) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-sm",
          // Full-bleed tables keep the page's 20px gutter on their edge cells.
          inset === true &&
            "[&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5",
          // A table filling a card keeps the card header's 16px edge instead.
          inset === "card" &&
            "[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4",
          size === "compact" &&
            "text-xs [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:h-8 [&_th]:px-2.5 [&_th]:text-[11px]",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}
function TableRow({
  className,
  selected,
  onClick,
  onKeyDown,
  ...props
}: React.ComponentProps<"tr"> & { selected?: boolean }) {
  // A clickable row is reachable and activatable from the keyboard. It keeps
  // its implicit row role rather than taking role="button", which would break
  // the table semantics for a screen reader.
  const activatable = onClick != null
  return (
    <tr
      data-slot="table-row"
      data-state={selected ? "selected" : undefined}
      className={cn(
        "border-b border-(--c-rule) transition-colors hover:bg-(--c-fill-soft) has-aria-expanded:bg-(--c-fill-soft) data-[state=selected]:bg-(--c-fill)",
        // The selected row carries the mark's red capsule on its leading edge.
        "data-[state=selected]:[&>td:first-child]:shadow-[inset_2px_0_0_var(--c-mark)]",
        activatable &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
        className
      )}
      tabIndex={activatable ? 0 : undefined}
      aria-selected={activatable ? Boolean(selected) : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!activatable || event.defaultPrevented) return
        if (event.key !== "Enter" && event.key !== " ") return
        // Space on a focused row would otherwise scroll the list.
        event.preventDefault()
        event.currentTarget.click()
      }}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3.5 text-left align-middle text-[11.5px] font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3.5 py-2 align-middle whitespace-nowrap tabular-nums [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}
export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
