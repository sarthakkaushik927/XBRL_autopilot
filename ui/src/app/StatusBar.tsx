import { cn } from '@/lib/cn'
import { useSidecar } from '@/stores/sidecar'
import { useUi } from '@/stores/ui'
import { LayoutToggles } from './LayoutToggles'
import { useWorkspace } from './workspace'

export function StatusBar() {
  const { status, app } = useSidecar()
  const filing = useWorkspace()
  const problems = filing?.problems ?? null
  const openProblems = useUi((s) => s.setBottomTab)
  const dot =
    status.state === 'ready' ? 'bg-ok' : status.state === 'starting' ? 'bg-warn animate-pulse' : 'bg-err'
  const label =
    status.state === 'ready' ? `Backend connected (v${status.version})` : status.state === 'starting' ? 'Connecting to the backend…' : 'Backend not reachable'
  const ai =
    status.state === 'ready' ? (status.aiEnabled ? `Groq · ${status.model}` : 'AI off (no Groq key)') : null

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel-2 px-3 text-[11px] text-muted">
      {filing ? (
        <>
          <span className="font-mono">{filing.header.cin}</span>
          <span>{filing.header.fyLabel}</span>
          <span>{filing.header.nature}</span>
          <span data-testid="filing-taxonomy">{filing.taxonomy}</span>
          <span className={filing.saveState === 'Saved' ? '' : 'text-warn'} data-testid="save-state">
            {filing.saveState}
          </span>
          {problems && (
            <button className="flex items-center gap-2 hover:text-fg" onClick={() => openProblems('problems')} title="Problems" data-testid="status-problems">
              <span className={problems.errors ? 'text-err' : ''}>{problems.errors} errors</span>
              <span className={problems.warnings ? 'text-warn' : ''}>{problems.warnings} warnings</span>
            </button>
          )}
        </>
      ) : (
        <span>No filing open</span>
      )}
      <div className="flex-1" />
      <span
        className="flex items-center gap-1.5"
        title={status.state === 'error' ? status.message : status.state === 'ready' ? status.url : undefined}
        data-testid="sidecar-status"
        data-state={status.state}
      >
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      {ai && <span>{ai}</span>}
      {app && <span>v{app.version}{app.isDev ? ' · dev' : ''}</span>}
      <LayoutToggles className="-mr-1 border-l border-border pl-2" />
    </footer>
  )
}
