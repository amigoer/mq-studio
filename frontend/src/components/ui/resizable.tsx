'use client'

import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

type Direction = 'horizontal' | 'vertical'

function ResizablePanelGroup({
  className,
  direction = 'horizontal',
  ...props
}: React.ComponentPropsWithoutRef<typeof Group> & { direction?: Direction }) {
  return (
    <Group
      orientation={direction}
      className={cn('flex h-full w-full', direction === 'vertical' && 'flex-col', className)}
      {...props}
    />
  )
}
ResizablePanelGroup.displayName = 'ResizablePanelGroup'

function ResizablePanel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Panel>) {
  return <Panel className={cn(className)} {...props} />
}
ResizablePanel.displayName = 'ResizablePanel'

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Separator> & {
  withHandle?: boolean
}) => (
  <Separator
    className={cn(
      'relative flex w-px items-center justify-center bg-border/20 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2',
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border/40 bg-muted/50">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}
  </Separator>
)
ResizableHandle.displayName = 'ResizableHandle'

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
