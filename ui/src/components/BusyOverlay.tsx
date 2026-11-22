/**
 * Long work in progress (Auto-tag, converting a workbook, Generate XML): a modal card over the editor so nothing that
 * conflicts with it can be clicked, with what is running, the current step and, when known, how far it is
 * (PR #15 review, points 2 and 3). Presentational: the caller says what runs.
 */
import { Loader2 } from 'lucide-react'
import { ProgressBar } from './Loading'
import { Button } from './ui/primitives'

export interface BusyInfo {
  label: string
  /** e.g. the sheet being auto-tagged */
  step?: string | null
  progress?: { done: number; total: number } | null
  /** what the numbers count, e.g. "lines" */
  unit?: string
  /** when the work can be stopped: Cancel calls it */
  onCancel?: () => void
  /** what Cancel keeps, shown beside the button */
  cancelHint?: string
}

export function BusyOverlay({ busy }: { busy: BusyInfo | null }) {
  if (!busy) return null
  const p = busy.progress
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/55 backdrop-blur-[1px]" role="alertdialog" aria-modal="true" aria-label={busy.label} data-testid="busy-overlay">
      <div className="flex w-80 flex-col gap-3 rounded-lg border border-border bg-panel p-4 shadow-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
          <span className="min-w-0 flex-1 truncate" data-testid="busy-label">
            {busy.label}
          </span>
        </div>
        {busy.step && <div className="truncate text-xs text-muted">{busy.step}</div>}
        {p && p.total > 0 ? (
          <>
            <ProgressBar done={p.done} total={p.total} />
            <div className="text-[11px] text-muted" data-testid="busy-progress">
              {p.done} of {p.total} {busy.unit ?? ''}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted">This can take a moment…</div>
        )}
        {busy.onCancel && (
          <div className="flex items-center gap-2 border-t border-border pt-3">
            {busy.cancelHint && <span className="min-w-0 flex-1 text-[11px] text-muted">{busy.cancelHint}</span>}
            <Button className="ml-auto h-7 px-3 text-xs" onClick={busy.onCancel} data-testid="busy-cancel">
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
