"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  inset,
  ...props
}: React.ComponentProps<"table"> & { inset?: boolean }) {
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
          inset &&
            "[&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5",
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
      className={cn("[&_tr]:border-b", className)}
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

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
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
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
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
        "h-8 px-3.5 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
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
        "px-3.5 py-[7px] align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
