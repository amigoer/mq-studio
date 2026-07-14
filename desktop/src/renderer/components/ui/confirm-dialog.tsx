import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  // 打开时聚焦取消按钮（安全默认）
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
  }, [open])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel()
    },
    [onCancel],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="w-full max-w-sm rounded-xl border border-border/50 bg-background p-6 shadow-lg duration-150 animate-in fade-in zoom-in-95"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-foreground">
          {title}
        </h2>
        <p id="confirm-desc" className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            data-cancel
            onClick={onCancel}
            className="h-9 rounded-lg border border-border/50 bg-background px-4 text-sm text-foreground transition-colors hover:bg-accent/50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'h-9 rounded-lg px-4 text-sm font-medium transition-colors',
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
