/**
 * Problems of an Ind AS filing: what Generate still needs, the totals that don't add up (live, client-side) and the
 * MCA checks' answer to the last Generate. Double-click a total → its statement in the XBRL Form.
 */
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { useIndasElrs, useIndasProblems } from '@/app/workspace'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useUi } from '@/stores/ui'
import type { IndasProblem } from './workspace'

const SOURCE: Record<IndasProblem['source'], string> = { readiness: 'Before generating', difference: 'Difference', mca: 'MCA checks' }

export function IndasProblemsPanel() {
  const problems = useIndasProblems()
  const elrs = useIndasElrs()
  const generated = useIndas((s) => (s.result?.ok ? s.result.fileName : null))
  const open = (p: IndasProblem) => {
    const entry = p.elr ? elrs.find((e) => e.code === p.elr && e.kind !== 'texts') : undefined
    if (!entry) return
    useIndas.getState().setActiveElr(entry.uri)
    if (p.concept) useIndas.setState({ focus: { concept: p.concept, seq: Date.now() } })
    useUi.getState().setRightTab('form')
  }
  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ok" data-testid="indas-problems-empty">
        <CircleCheck size={14} /> No problems{generated ? ` · ${generated} generated` : ''}
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto text-[12px]" data-testid="indas-problems">
      {problems.map((p, i) => {
        const Icon = p.severity === 'error' ? CircleAlert : TriangleAlert
        return (
          <div
            key={i}
            className={cn('flex items-start gap-2 border-b border-border/50 px-3 py-1 hover:bg-panel-2', p.elr && 'cursor-pointer')}
            onDoubleClick={() => open(p)}
            title={p.elr ? 'Double-click to open the statement' : undefined}
            data-testid="problem"
            data-severity={p.severity}
            data-source={p.source}
          >
            <Icon size={13} className={cn('mt-0.5 shrink-0', p.severity === 'error' ? 'text-err' : 'text-warn')} />
            <span className="w-28 shrink-0 text-[11px] text-muted">{SOURCE[p.source]}</span>
            <span className="min-w-0 flex-1">{p.message}</span>
          </div>
        )
      })}
    </div>
  )
}
