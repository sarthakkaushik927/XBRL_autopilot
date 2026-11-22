/**
 * Problems of an Ind AS filing: what Generate still needs, the totals that don't add up (live, client-side) and the
 * MCA checks' answer to the last Generate. Double-click a problem to go where it is fixed (PR #15 review, point 9):
 * the line's cell in Excel and its fact in the Form, the concept to tag in the Form, or the details dialog.
 * ✦ Fix with AI (one total, or all of them) asks for tag changes; they arrive as cards in the left AI chat.
 */
import { CircleAlert, CircleCheck, CornerDownRight, Sparkles, TriangleAlert } from 'lucide-react'
import { useIndasProblems } from '@/app/workspace'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useIndasFix } from '@/stores/indas-fix'
import type { IndasProblem, ProblemTarget } from './workspace'

const SOURCE: Record<IndasProblem['source'], string> = { readiness: 'Before generating', difference: 'Difference', mca: 'MCA checks' }

const GOES_TO: Record<ProblemTarget['kind'], string> = {
  line: 'Double-click to show the cell in Excel and its fact in the XBRL Form',
  concept: 'Double-click to show the concept in the XBRL Form (select a line in Excel, then double-click the concept to tag it)',
  masters: 'Double-click to open Company, auditor & signatories',
  settings: 'Double-click to open Filing settings',
}

export function IndasProblemsPanel() {
  const problems = useIndasProblems()
  const generated = useIndas((s) => (s.result?.ok ? s.result.fileName : null))
  const goTo = useIndas((s) => s.goToProblem)
  const ask = useIndasFix((s) => s.ask)
  const fixable = problems.flatMap((p) => (p.fix ? [p.fix] : []))
  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ok" data-testid="indas-problems-empty">
        <CircleCheck size={14} /> No problems{generated ? ` · ${generated} generated` : ''}
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto text-[12px]" data-testid="indas-problems">
      {fixable.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-panel px-3 py-1">
          <span className="flex-1 text-[11px] text-muted">{fixable.length} total(s) don't add up</span>
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10"
            onClick={() => void ask(fixable)}
            title="Ask the AI which tags to change so these totals add up (line items, headings and amounts are sent; you accept each change)"
            data-testid="fix-all-ai"
          >
            <Sparkles size={12} /> Fix all with AI
          </button>
        </div>
      )}
      {problems.map((p, i) => {
        const Icon = p.severity === 'error' ? CircleAlert : TriangleAlert
        const target = p.target
        return (
          <div
            key={i}
            className={cn('group flex items-start gap-2 border-b border-border/50 px-3 py-1 hover:bg-panel-2', target && 'cursor-pointer')}
            onDoubleClick={() => target && goTo(target)}
            title={target ? GOES_TO[target.kind] : undefined}
            data-testid="problem"
            data-severity={p.severity}
            data-source={p.source}
            data-target={target?.kind ?? ''}
          >
            <Icon size={13} className={cn('mt-0.5 shrink-0', p.severity === 'error' ? 'text-err' : 'text-warn')} />
            <span className="w-28 shrink-0 text-[11px] text-muted">{SOURCE[p.source]}</span>
            <span className="min-w-0 flex-1 select-text">{p.message}</span>
            {p.fix && (
              <button
                className="flex shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-accent hover:bg-accent/10"
                onClick={() => void ask([p.fix!])}
                onDoubleClick={(e) => e.stopPropagation()}
                title="Fix this total with AI: proposed tag changes arrive in the AI chat, you accept each one"
                data-testid="fix-ai"
              >
                <Sparkles size={12} /> Fix with AI
              </button>
            )}
            {target && (
              <button className="shrink-0 text-muted opacity-0 group-hover:opacity-100 hover:text-fg" onClick={() => goTo(target)} title={GOES_TO[target.kind].replace('Double-click to', 'Go:')} aria-label="Go to the problem">
                <CornerDownRight size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
