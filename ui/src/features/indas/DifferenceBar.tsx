import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'

const fmt = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : s
}

/** docs/15 §5 "Diff = 0.00 check bar": totals vs their tagged lines, live as the CA tags (exact decimals in the sidecar). */
export function DifferenceBar() {
  const check = useIndas((s) => s.check)
  const [open, setOpen] = useState(false)
  if (!check) return <div className="rounded-md border border-border bg-panel px-3 py-1.5 text-xs text-muted">Difference: checking…</div>
  const ok = check.differences.length === 0
  return (
    <section className={cn('rounded-md border text-xs', ok ? 'border-ok/40 bg-ok/5' : 'border-err/40 bg-err/5')} data-testid="indas-difference">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left" onClick={() => setOpen(!open)} disabled={ok}>
        {ok ? <CheckCircle2 size={14} className="text-ok" /> : <XCircle size={14} className="text-err" />}
        <span className={cn('font-semibold', ok ? 'text-ok' : 'text-err')}>Difference {fmt(check.total)}</span>
        <span className="text-muted">
          {ok ? 'every tagged total equals its tagged lines' : `${check.differences.length} total(s) don't add up — click to see`}
        </span>
        {!ok && (open ? <ChevronDown size={14} className="ml-auto" /> : <ChevronRight size={14} className="ml-auto" />)}
      </button>
      {open && !ok && (
        <ul className="border-t border-err/20 px-3 py-1.5">
          {check.differences.map((d, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <span className="w-7 shrink-0 font-mono text-muted">{d.year}</span>
              <span className="min-w-0 flex-1 truncate" title={d.concept}>
                {d.label}
              </span>
              <span className="font-mono tabular-nums text-muted">
                {fmt(d.reported)} vs {fmt(d.calculated)}
              </span>
              <span className="w-28 text-right font-mono tabular-nums text-err">{fmt(d.difference)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
