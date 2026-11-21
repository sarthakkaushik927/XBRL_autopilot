import { Sparkles } from 'lucide-react'
import type { ConceptSuggestion, PeriodRole } from '@shared/indas'
import { Input } from '@/components/ui/primitives'
import { isInstant } from './model'

/** Pick one of the suggestions (the AI's pick marked ✦) or type a qname. AI only proposes; this is the accept. */
export function ConceptPicker(props: {
  label: string
  suggestions: ConceptSuggestion[]
  value: string
  onChange(qname: string): void
  placeholder?: string
}) {
  const known = props.suggestions.some((s) => s.qname === props.value)
  return (
    <div className="flex flex-col gap-1">
      <select
        className="h-7 w-full rounded border border-border bg-panel px-1.5 text-[12px]"
        value={known ? props.value : props.value ? '__other' : ''}
        onChange={(e) => e.target.value !== '__other' && props.onChange(e.target.value)}
        aria-label={props.label}
      >
        <option value="">{props.suggestions.length ? '— choose a suggestion —' : '— not tagged —'}</option>
        {props.suggestions.map((s) => (
          <option key={s.qname} value={s.qname}>
            {s.pickedBy === 'ai' ? '✦ ' : ''}
            {s.label} · {s.qname}
          </option>
        ))}
        {props.value && !known && <option value="__other">{props.value}</option>}
      </select>
      <Input
        className="h-7 font-mono text-[11px]"
        placeholder={props.placeholder ?? 'or type a concept, e.g. ind-as:Inventories'}
        value={known ? '' : props.value}
        onChange={(e) => props.onChange(e.target.value.trim())}
      />
    </div>
  )
}

/** "✦ AI pick" hint under a picker whose accepted value is the AI's choice. */
export function AiPickHint(props: { suggestions: ConceptSuggestion[]; value: string }) {
  const s = props.suggestions.find((x) => x.qname === props.value)
  if (s?.pickedBy !== 'ai') return null
  return (
    <span className="flex items-center gap-1 text-[10px] text-accent">
      <Sparkles size={10} /> AI pick — check it
    </span>
  )
}

/** Closing / opening balance, only for an instant concept (an opening balance is reported at the year's start). */
export function PeriodRoleSelect(props: { concept: string; suggestions: ConceptSuggestion[]; value: PeriodRole; onChange(r: PeriodRole): void }) {
  if (!props.concept || !isInstant(props.concept, props.suggestions)) return null
  return (
    <select
      className="h-6 rounded border border-border bg-panel px-1 text-[11px]"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as PeriodRole)}
      aria-label="Closing or opening balance"
    >
      <option value="end">Closing balance</option>
      <option value="start">Opening balance</option>
    </select>
  )
}
