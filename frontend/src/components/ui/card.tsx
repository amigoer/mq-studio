import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 rounded-[10px] border bg-card py-6 text-card-foreground",
        className
      )}
      {...props}
    />
  )
}
export { Card };
