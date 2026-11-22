/**
 * Loading feedback (PR #15 review): a spinner with a label for a pane that waits for data, a thin indeterminate line
 * for background work, and a progress bar for long work that knows how far it is.
 */
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** A pane waiting for its data: spinner + what it is loading. */
export function Loading({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted', className)} role="status" aria-live="polite" data-testid="loading">
      <Loader2 size={22} className="animate-spin text-accent" />
      <div className="text-xs">{label}</div>
    </div>
  )
}

/** A thin indeterminate line, shown only when the work takes longer than `delayMs` (no flicker for quick calls). */
export function ProgressLine({ active, delayMs = 250, className }: { active: boolean; delayMs?: number; className?: string }) {
  const shown = useDelayed(active, delayMs)
  return (
    <div className={cn('relative h-0.5 w-full overflow-hidden', className)} role={shown ? 'progressbar' : undefined} aria-busy={shown} data-testid="progress-line" data-active={shown || undefined}>
      {shown && <div className="absolute inset-y-0 w-1/3 animate-[xap-indeterminate_1.1s_ease-in-out_infinite] bg-accent" />}
    </div>
  )
}

/** A determinate bar: done / total, with the share as text. */
export function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const share = total > 0 ? Math.min(1, done / total) : 0
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">{Math.round(share * 100)}%</span>
    </div>
  )
}

/** `value`, but true only after it has stayed true for `delayMs`. */
function useDelayed(value: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!value) return setShown(false)
    const t = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return shown
}
