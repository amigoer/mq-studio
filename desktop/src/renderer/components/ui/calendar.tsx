import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { cn } from '@/lib/utils'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        root: 'rounded-md border border-border/40 bg-card text-card-foreground',
        month: 'space-y-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        nav: 'flex items-center gap-1',
        button_previous:
          'absolute left-1 h-7 w-7 rounded-md border border-input bg-background p-0 opacity-100 hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center',
        button_next:
          'absolute right-1 h-7 w-7 rounded-md border border-input bg-background p-0 opacity-100 hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center',
        caption_label: 'text-sm font-medium',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'h-8 w-8 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
        day_button:
          'h-8 w-8 rounded-md p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground inline-flex items-center justify-center',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        outside: 'text-muted-foreground opacity-50',
        today: 'bg-accent text-accent-foreground',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
