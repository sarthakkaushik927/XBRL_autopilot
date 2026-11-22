import { Check, Sparkles, X } from 'lucide-react'
import type { ConceptSuggestion, PeriodRole } from '@shared/indas'
import { cn } from '@/lib/cn'
import { isInstant } from './model'

/**
 * One compact cell per line: the accepted concept (× to clear), or the top suggestion with ✓ accept / ✗ next.
 * The full choice is the taxonomy tree on the right. AI only proposes; ✓ or a tree click is the accept.
 */
export function ConceptCell(props: {
  value: string
  suggestions: ConceptSuggestion[]
  onAccept(qname: string): void
  onReject(): void
  onClear(): void
  selected: boolean
}) {
  if (props.value) {
    const picked = props.suggestions.find((s) => s.qname === props.value)
    return (
      <div className="flex items-center gap-1.5 rounded border border-ok/40 bg-ok/5 px-1.5 py-1 text-[12px]">
        {picked?.pickedBy === 'ai' ? <Sparkles size={11} className="shrink-0 text-accent" aria-label="Tagged by the AI: check it" /> : <Check size={12} className="shrink-0 text-ok" />}
        <span className="min-w-0 flex-1 truncate" title={props.value}>
          {picked?.label ?? props.value.split(':')[1] ?? props.value}
        </span>
        <button className="text-muted hover:text-err" title="Untag" onClick={(e) => (e.stopPropagation(), props.onClear())}>
          <X size={12} />
        </button>
      </div>
    )
  }
  const top = props.suggestions[0]
  if (!top) {
    return <div className={cn('px-1.5 py-1 text-[11px]', props.selected ? 'text-accent' : 'text-muted')}>{props.selected ? 'Pick in the tree →' : 'Not tagged'}</div>
  }
  return (
    <div className="flex items-center gap-1.5 rounded border border-warn/40 bg-warn/5 px-1.5 py-1 text-[12px]">
      {top.pickedBy === 'ai' && <Sparkles size={11} className="shrink-0 text-accent" aria-label="AI pick" />}
      <span className="min-w-0 flex-1 truncate" title={`${top.qname} — suggested${top.pickedBy === 'ai' ? ' by AI, check it' : ''}`}>
        {top.label}
      </span>
      <button className="rounded px-0.5 text-ok hover:bg-ok/10" title="Accept" onClick={(e) => (e.stopPropagation(), props.onAccept(top.qname))}>
        <Check size={13} />
      </button>
      <button className="rounded px-0.5 text-muted hover:bg-err/10 hover:text-err" title="Not this one (show the next suggestion)" onClick={(e) => (e.stopPropagation(), props.onReject())}>
        <X size={13} />
      </button>
    </div>
  )
}

/** Closing / opening balance, only for an instant concept (an opening balance is reported at the year's start). */
export function PeriodRoleSelect(props: { concept: string; suggestions: ConceptSuggestion[]; value: PeriodRole; onChange(r: PeriodRole): void }) {
  if (!props.concept || !isInstant(props.concept, props.suggestions)) return null
  return (
    <select
      className="mt-1 h-6 rounded border border-border bg-panel px-1 text-[11px]"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as PeriodRole)}
      aria-label="Closing or opening balance"
    >
      <option value="end">Closing balance</option>
      <option value="start">Opening balance</option>
    </select>
  )
}
