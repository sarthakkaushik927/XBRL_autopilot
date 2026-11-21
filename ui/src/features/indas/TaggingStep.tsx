import { CheckCheck, Plus, Sparkles, Trash2 } from 'lucide-react'
import { LINE_SHEETS, type StatementKey } from '@shared/indas'
import { Button, Input } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas, type TagTab } from '@/stores/indas'
import { AiPickHint, ConceptPicker, PeriodRoleSelect } from './ConceptPicker'
import { formatAmount } from './model'

const TABS: { id: TagTab; title: string; hint: string }[] = [
  ...LINE_SHEETS.map((s) => ({ id: s.key as TagTab, title: s.title, hint: s.key === 'noteLines' ? 'Numeric note lines [L], against the note ELRs' : 'Line tags [L], against this statement’s ELR' })),
  { id: 'socie', title: 'Changes in Equity', hint: 'Table [T]: each movement is a concept × an equity component' },
  { id: 'ppe', title: 'Fixed Assets', hint: 'Table [T]: each asset class is a member; the columns map to fixed fields' },
  { id: 'texts', title: 'Notes text', hint: 'Text blocks [E]: paste each note’s narrative and pick its text block' },
]

/** Step 2: every canonical sheet is tagged in its own tab (docs/15 §5); suggestions come from that sheet's scope only. */
export function TaggingStep() {
  const s = useIndas()
  const counts = tabCounts(s)
  const active = TABS.find((t) => t.id === s.tab)!
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6">
      <nav className="flex flex-wrap gap-1 border-b border-border pb-2" data-testid="indas-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => s.setTab(t.id)}
            className={cn('rounded px-2.5 py-1 text-xs', t.id === s.tab ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-panel-2 hover:text-fg')}
          >
            {t.title} <span className="opacity-75">{counts[t.id].done}/{counts[t.id].total}</span>
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!!s.busy || counts[s.tab].total === 0} onClick={() => void s.suggest()} data-testid="indas-suggest">
          <Sparkles size={14} /> Suggest tags
        </Button>
        <Button disabled={!!s.busy} onClick={() => s.acceptTop()} title="Accept the first suggestion on every line of this tab you haven't tagged">
          <CheckCheck size={14} /> Accept top suggestions
        </Button>
        <span className="text-xs text-muted">{active.hint}</span>
      </div>
      {isLine(s.tab) ? <LinesTable statement={s.tab} /> : s.tab === 'socie' ? <SocieTable /> : s.tab === 'ppe' ? <PpeTable /> : <TextBlocks />}
    </div>
  )
}

const isLine = (t: TagTab): t is StatementKey => LINE_SHEETS.some((s) => s.key === t)

function tabCounts(s: ReturnType<typeof useIndas.getState>): Record<TagTab, { done: number; total: number }> {
  const out = {} as Record<TagTab, { done: number; total: number }>
  for (const st of LINE_SHEETS) {
    const mine = s.rows.filter((r) => r.statement === st.key)
    out[st.key] = { done: mine.filter((r) => r.concept).length, total: mine.length }
  }
  out.socie = { done: s.socie.filter((r) => r.concept && r.member).length, total: s.socie.length }
  out.ppe = { done: s.ppe.filter((r) => r.member).length, total: s.ppe.length }
  out.texts = { done: s.texts.filter((r) => r.concept && r.content.trim()).length, total: s.texts.length }
  return out
}

function Empty(props: { children: React.ReactNode }) {
  return <p className="rounded-md border border-border bg-panel p-6 text-center text-xs text-muted">{props.children}</p>
}

function LinesTable({ statement }: { statement: StatementKey }) {
  const { rows, setConcept, setPeriodRole } = useIndas()
  const lines = rows.filter((r) => r.statement === statement)
  if (lines.length === 0) return <Empty>No lines with amounts in this sheet.</Empty>
  return (
    <section className="rounded-md border border-border bg-panel">
      <table className="w-full text-[12px]">
        <thead className="bg-panel-2 text-left text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Line item</th>
            <th className="w-12 px-2 py-1.5 font-medium">Note</th>
            <th className="w-32 px-2 py-1.5 text-right font-medium">Current year</th>
            <th className="w-32 px-2 py-1.5 text-right font-medium">Previous year</th>
            <th className="w-[36%] px-2 py-1.5 font-medium">XBRL concept</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((r) => (
            <tr key={r.id} className={cn('border-t border-border/60 align-top', !r.concept && 'bg-warn/5')}>
              <td className="px-2 py-1">
                <div>{r.label}</div>
                {r.breadcrumb && r.breadcrumb !== r.label && <div className="text-[11px] text-muted">{r.breadcrumb}</div>}
              </td>
              <td className="px-2 py-1 text-muted">{r.note}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.cy)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.py)}</td>
              <td className="px-2 py-1">
                <ConceptPicker label={`Concept for ${r.label}`} suggestions={r.suggestions} value={r.concept} onChange={(q) => setConcept(r.id, q)} />
                <div className="mt-1 flex items-center gap-2">
                  <PeriodRoleSelect concept={r.concept} suggestions={r.suggestions} value={r.periodRole} onChange={(role) => setPeriodRole(r.id, role)} />
                  <AiPickHint suggestions={r.suggestions} value={r.concept} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function SocieTable() {
  const { socie, setConcept, setMember, setPeriodRole } = useIndas()
  if (socie.length === 0) return <Empty>No changes-in-equity rows with amounts.</Empty>
  return (
    <section className="rounded-md border border-border bg-panel">
      <table className="w-full text-[12px]">
        <thead className="bg-panel-2 text-left text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Movement</th>
            <th className="w-28 px-2 py-1.5 text-right font-medium">Current year</th>
            <th className="w-28 px-2 py-1.5 text-right font-medium">Previous year</th>
            <th className="w-[26%] px-2 py-1.5 font-medium">Equity component (member)</th>
            <th className="w-[30%] px-2 py-1.5 font-medium">Concept</th>
          </tr>
        </thead>
        <tbody>
          {socie.map((r) => (
            <tr key={r.id} className={cn('border-t border-border/60 align-top', !(r.concept && r.member) && 'bg-warn/5')}>
              <td className="px-2 py-1">
                <div>{r.description}</div>
                <div className="text-[11px] text-muted">{r.component}</div>
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.cy)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.py)}</td>
              <td className="px-2 py-1">
                <ConceptPicker label={`Component for ${r.description}`} suggestions={r.memberSuggestions} value={r.member} onChange={(q) => setMember(r.id, q)} placeholder="or type a member" />
                <AiPickHint suggestions={r.memberSuggestions} value={r.member} />
              </td>
              <td className="px-2 py-1">
                <ConceptPicker label={`Concept for ${r.description}`} suggestions={r.suggestions} value={r.concept} onChange={(q) => setConcept(r.id, q)} />
                <div className="mt-1 flex items-center gap-2">
                  <PeriodRoleSelect concept={r.concept} suggestions={r.suggestions} value={r.periodRole} onChange={(role) => setPeriodRole(r.id, role)} />
                  <AiPickHint suggestions={r.suggestions} value={r.concept} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PpeTable() {
  const { ppe, setMember } = useIndas()
  if (ppe.length === 0) return <Empty>No fixed-asset classes in this workbook.</Empty>
  const cols: [string, string][] = [
    ['Gross_Opening', 'Gross opening'],
    ['Gross_Additions', 'Additions'],
    ['Gross_Disposals', 'Disposals'],
    ['Gross_Closing', 'Gross closing'],
    ['Dep_Closing', 'Acc. depreciation'],
    ['Net_Current_Year', 'Net block CY'],
  ]
  return (
    <section className="overflow-x-auto rounded-md border border-border bg-panel">
      <table className="w-full text-[12px]">
        <thead className="bg-panel-2 text-left text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Asset class</th>
            {cols.map(([, t]) => (
              <th key={t} className="px-2 py-1.5 text-right font-medium">
                {t}
              </th>
            ))}
            <th className="w-[28%] px-2 py-1.5 font-medium">Class (member)</th>
          </tr>
        </thead>
        <tbody>
          {ppe.map((r) => (
            <tr key={r.id} className={cn('border-t border-border/60 align-top', !r.member && 'bg-warn/5')}>
              <td className="px-2 py-1">{r.assetClass}</td>
              {cols.map(([c]) => (
                <td key={c} className="px-2 py-1 text-right font-mono tabular-nums">
                  {formatAmount(r.amounts[c] ?? null)}
                </td>
              ))}
              <td className="px-2 py-1">
                <ConceptPicker label={`Class for ${r.assetClass}`} suggestions={r.memberSuggestions} value={r.member} onChange={(q) => setMember(r.id, q)} placeholder="or type a member" />
                <AiPickHint suggestions={r.memberSuggestions} value={r.member} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TextBlocks() {
  const { texts, addTextBlock, updateTextBlock, removeTextBlock, setConcept } = useIndas()
  return (
    <div className="flex flex-col gap-3">
      {texts.length === 0 && <Empty>No note text yet. Add a note, give it its heading and paste its text from the annual report.</Empty>}
      {texts.map((t) => (
        <section key={t.id} className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3">
          <div className="grid grid-cols-[1fr_40%_auto] items-start gap-2">
            <Input placeholder="Note heading, e.g. Significant accounting policies" value={t.heading} onChange={(e) => updateTextBlock(t.id, { heading: e.target.value })} />
            <div>
              <ConceptPicker label={`Text block for ${t.heading || 'note'}`} suggestions={t.suggestions} value={t.concept} onChange={(q) => setConcept(t.id, q)} placeholder="or type a text block concept" />
              <AiPickHint suggestions={t.suggestions} value={t.concept} />
            </div>
            <Button variant="ghost" title="Remove" onClick={() => removeTextBlock(t.id)}>
              <Trash2 size={14} />
            </Button>
          </div>
          <textarea
            className="min-h-24 w-full rounded border border-border bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
            placeholder="Paste the note's text"
            value={t.content}
            onChange={(e) => updateTextBlock(t.id, { content: e.target.value })}
          />
        </section>
      ))}
      <Button className="self-start" onClick={addTextBlock}>
        <Plus size={14} /> Add note text
      </Button>
    </div>
  )
}
