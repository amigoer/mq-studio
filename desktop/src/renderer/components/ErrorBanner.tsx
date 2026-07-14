import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ErrorBanner({ message, className }: { message: string; className?: string }) {
  if (!message) return null
  return (
    <div className={cn('rl-error-banner', className)} role="alert">
      <AlertCircle size={14} className="shrink-0" />
      <span className="min-w-0 text-[12px] leading-snug">{message}</span>
    </div>
  )
}
