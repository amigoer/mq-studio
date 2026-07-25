import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-fs-11 font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-background text-foreground',
        success: 'border-transparent bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]',
        warning: 'border-transparent bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]',
        destructive:
          'border-transparent bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))]',
        info: 'border-transparent bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
