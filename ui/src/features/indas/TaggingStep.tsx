import { useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react'
import { LINE_SHEETS, PPE_TABLE, SOCIE_TABLE, TEXT_BLOCKS_SCOPE, type ConceptSuggestion, type StatementKey } from '@shared/indas'
import { Button, Input } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { isLineTab, useIndas, type TagTab } from '@/stores/indas'
import { ConceptCell, PeriodRoleSelect } from './ConceptCell'
import { DifferenceBar } from './DifferenceBar'
import { formatAmount, groupByNote, type TagRow } from './model'
import { TaxonomyPane } from './TaxonomyPane'

const TABS: { id: TagTab; title: string; hint: string }[] = [
  ...LINE_SHEETS.map((s) => ({ id: s.key as TagTab, title: s.title, hint: s.key === 'noteLines' ? 'Note lines [L], grouped by note' : 'Line tags [L]' })),
  { id: 'socie', title: 'Changes in Equity', hint: 'Table [T]: movement × equity component' },
  { id: 'ppe', title: 'Fixed Assets', hint: 'Table [T]: each asset class is a member' },
  { id: 'texts', title: 'Notes text', hint: 'Text blocks [E]' },
]

/**
 * Step 2, the split view of docs/15 §5 and webXBRL (docs/13 §11.3): the sheet's lines on the left, its taxonomy
 * tree on the right. Select a line, then click its concept (or ✓ the suggestion). Difference bar on top.
 */
export function TaggingStep() {
  const s = useIndas()
  const counts = tabCounts(s)
  const active = TABS.find((t) => t.id === s.tab)!
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-4 py-3">
      <nav className="flex flex-wrap items-center gap-1" data-testid="indas-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => s.setTab(t.id)}
            className={cn('rounded px-2.5 py-1 text-xs', t.id === s.tab ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-panel-2 hover:text-fg')}
          >
            {t.title}{' '}
            <span className={cn('opacity-75', counts[t.id].total > 0 && counts[t.id].done === counts[t.id].total && t.id !== s.tab && 'text-ok')}>
              {counts[t.id].done}/{counts[t.id].total}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted">{active.hint}</span>
          <Button variant="primary" disabled={!!s.busy || counts[s.tab].total === 0} onClick={() => void s.suggest()} data-testid="indas-suggest">
            <Sparkles size={14} /> Suggest tags
          </Button>
          <Button disabled={!!s.busy} onClick={() => s.acceptTop()} title="Accept the first suggestion on every line of this tab you haven't tagged">
            <CheckCheck size={14} /> Accept all suggestions
          </Button>
        </div>
      </nav>
      {isLineTab(s.tab) && <DifferenceBar />}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(280px,2fr)] gap-3">
        <div className="min-h-0 overflow-auto rounded-md border border-border bg-panel">
          {isLineTab(s.tab) ? <Lines statement={s.tab} /> : s.tab === 'socie' ? <Socie /> : s.tab === 'ppe' ? <Ppe /> : <Texts />}
        </div>
        <RightPane />
      </div>
    </div>
  )
}

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

/** The right pane follows the tab and, in Changes in Equity, the selected field (component or concept). */
function RightPane() {
  const s = useIndas()
  const sel = s.selection
  let scope: string = SOCIE_TABLE.sheet
  let kind: 'concept' | 'member' = 'concept'
  let title = ''
  let current = ''
  let suggested: ConceptSuggestion[] = []
  const tagged = new Map<string, number>()
  const count = (q: string) => q && tagged.set(q, (tagged.get(q) ?? 0) + 1)

  if (isLineTab(s.tab)) {
    scope = LINE_SHEETS.find((x) => x.key === s.tab)!.sheet
    title = `${LINE_SHEETS.find((x) => x.key === s.tab)!.title} — taxonomy`
    const rows = s.rows.filter((r) => r.statement === s.tab)
    rows.forEach((r) => count(r.concept))
    const r = rows.find((x) => x.id === sel?.id)
    current = r?.concept ?? ''
    suggested = r?.suggestions ?? []
  } else if (s.tab === 'socie') {
    kind = sel?.field === 'member' ? 'member' : 'concept'
    title = kind === 'member' ? 'Components of equity (members)' : 'Changes in equity — concepts'
    s.socie.forEach((r) => count(kind === 'member' ? r.member : r.concept))
    const r = s.socie.find((x) => x.id === sel?.id)
    current = (kind === 'member' ? r?.member : r?.concept) ?? ''
    suggested = (kind === 'member' ? r?.memberSuggestions : r?.suggestions) ?? []
  } else if (s.tab === 'ppe') {
    scope = PPE_TABLE.sheet
    kind = 'member'
    title = 'Classes of property, plant and equipment (members)'
    s.ppe.forEach((r) => count(r.member))
    const r = s.ppe.find((x) => x.id === sel?.id)
    current = r?.member ?? ''
    suggested = r?.memberSuggestions ?? []
  } else {
    scope = TEXT_BLOCKS_SCOPE
    title = 'Text blocks [E]'
    s.texts.forEach((r) => count(r.concept))
    const r = s.texts.find((x) => x.id === sel?.id)
    current = r?.concept ?? ''
    suggested = r?.suggestions ?? []
  }
  return <TaxonomyPane scope={scope} kind={kind} title={title} tagged={tagged} current={current} suggested={suggested.map((x) => x.qname)} />
}

function Empty(props: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-muted">{props.children}</p>
}

function Lines({ statement }: { statement: StatementKey }) {
  const rows = useIndas((s) => s.rows).filter((r) => r.statement === statement)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const groups = useMemo(() => (statement === 'noteLines' ? groupByNote(rows) : [{ note: '', rows }]), [rows, statement])
  if (rows.length === 0) return <Empty>No lines with amounts in this sheet.</Empty>
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel-2 text-left text-muted">
        <tr>
          <th className="px-2 py-1.5 font-medium">Line item</th>
          {statement !== 'noteLines' && <th className="w-10 px-2 py-1.5 font-medium">Note</th>}
          <th className="w-28 px-2 py-1.5 text-right font-medium">Current year</th>
          <th className="w-28 px-2 py-1.5 text-right font-medium">Previous year</th>
          <th className="w-[38%] px-2 py-1.5 font-medium">Concept</th>
        </tr>
      </thead>
      {groups.map((g) => {
        const isClosed = closed.has(g.note)
        return (
          <tbody key={g.note || 'all'}>
            {statement === 'noteLines' && (
              <tr className="border-t border-border bg-panel-2/60">
                <td colSpan={4} className="px-2 py-1">
                  <button
                    className="flex items-center gap-1 text-[12px] font-semibold"
                    onClick={() => setClosed((c) => (c.has(g.note) ? new Set([...c].filter((x) => x !== g.note)) : new Set([...c, g.note])))}
                  >
                    {isClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} Note {g.note}
                    <span className="font-normal text-muted">
                      · {g.rows.filter((r) => r.concept).length}/{g.rows.length} tagged · {g.rows[0].breadcrumb.split(' > ')[0]}
                    </span>
                  </button>
                </td>
              </tr>
            )}
            {!isClosed && g.rows.map((r) => <LineRow key={r.id} row={r} showNote={statement !== 'noteLines'} />)}
          </tbody>
        )
      })}
    </table>
  )
}

function LineRow({ row: r, showNote }: { row: TagRow; showNote: boolean }) {
  const { selection, select, setConcept, rejectSuggestion, setPeriodRole } = useIndas()
  const selected = selection?.id === r.id
  const parent = r.breadcrumb.split(' > ').slice(0, -1).join(' › ')
  return (
    <tr
      onClick={() => select(r.id)}
      className={cn('cursor-pointer border-t border-border/60 align-top', selected ? 'bg-accent/10 outline outline-1 -outline-offset-1 outline-accent' : 'hover:bg-panel-2', !r.concept && !selected && 'bg-warn/5')}
      data-row={r.id}
    >
      <td className="px-2 py-1">
        <div>{r.label}</div>
        {parent && <div className="truncate text-[11px] text-muted">{parent}</div>}
      </td>
      {showNote && <td className="px-2 py-1 text-muted">{r.note}</td>}
      <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.cy)}</td>
      <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.py)}</td>
      <td className="px-2 py-1">
        <ConceptCell
          value={r.concept}
          suggestions={r.suggestions}
          selected={selected}
          onAccept={(q) => setConcept(r.id, q)}
          onReject={() => rejectSuggestion(r.id)}
          onClear={() => setConcept(r.id, '')}
        />
        <PeriodRoleSelect concept={r.concept} suggestions={r.suggestions} value={r.periodRole} onChange={(role) => setPeriodRole(r.id, role)} />
      </td>
    </tr>
  )
}

function Socie() {
  const { socie, selection, select, setConcept, setMember, rejectSuggestion, setPeriodRole } = useIndas()
  if (socie.length === 0) return <Empty>No changes-in-equity rows with amounts.</Empty>
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel-2 text-left text-muted">
        <tr>
          <th className="px-2 py-1.5 font-medium">Movement</th>
          <th className="w-24 px-2 py-1.5 text-right font-medium">CY</th>
          <th className="w-24 px-2 py-1.5 text-right font-medium">PY</th>
          <th className="w-[26%] px-2 py-1.5 font-medium">Component</th>
          <th className="w-[30%] px-2 py-1.5 font-medium">Concept</th>
        </tr>
      </thead>
      <tbody>
        {socie.map((r) => {
          const sel = (f: 'concept' | 'member') => selection?.id === r.id && selection.field === f
          return (
            <tr key={r.id} className={cn('border-t border-border/60 align-top', !(r.concept && r.member) && 'bg-warn/5')}>
              <td className="px-2 py-1">
                <div>{r.description}</div>
                <div className="text-[11px] text-muted">{r.component}</div>
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.cy)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(r.py)}</td>
              <td className={cn('cursor-pointer px-2 py-1', sel('member') && 'bg-accent/10')} onClick={() => select(r.id, 'member')}>
                <ConceptCell value={r.member} suggestions={r.memberSuggestions} selected={sel('member')} onAccept={(q) => setMember(r.id, q)} onReject={() => rejectSuggestion(r.id, 'member')} onClear={() => setMember(r.id, '')} />
              </td>
              <td className={cn('cursor-pointer px-2 py-1', sel('concept') && 'bg-accent/10')} onClick={() => select(r.id, 'concept')}>
                <ConceptCell value={r.concept} suggestions={r.suggestions} selected={sel('concept')} onAccept={(q) => setConcept(r.id, q)} onReject={() => rejectSuggestion(r.id)} onClear={() => setConcept(r.id, '')} />
                <PeriodRoleSelect concept={r.concept} suggestions={r.suggestions} value={r.periodRole} onChange={(role) => setPeriodRole(r.id, role)} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Ppe() {
  const { ppe, selection, select, setMember, rejectSuggestion } = useIndas()
  if (ppe.length === 0) return <Empty>No fixed-asset classes in this workbook.</Empty>
  const cols: [string, string][] = [
    ['Gross_Opening', 'Gross opening'],
    ['Gross_Additions', 'Additions'],
    ['Gross_Disposals', 'Disposals'],
    ['Gross_Closing', 'Gross closing'],
    ['Dep_Closing', 'Acc. dep.'],
    ['Net_Current_Year', 'Net CY'],
  ]
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel-2 text-left text-muted">
        <tr>
          <th className="px-2 py-1.5 font-medium">Asset class</th>
          {cols.map(([, t]) => (
            <th key={t} className="px-2 py-1.5 text-right font-medium">
              {t}
            </th>
          ))}
          <th className="w-[30%] px-2 py-1.5 font-medium">Class (member)</th>
        </tr>
      </thead>
      <tbody>
        {ppe.map((r) => {
          const selected = selection?.id === r.id
          return (
            <tr key={r.id} onClick={() => select(r.id, 'member')} className={cn('cursor-pointer border-t border-border/60 align-top', selected ? 'bg-accent/10' : 'hover:bg-panel-2', !r.member && !selected && 'bg-warn/5')}>
              <td className="px-2 py-1">{r.assetClass}</td>
              {cols.map(([c]) => (
                <td key={c} className="px-2 py-1 text-right font-mono tabular-nums">
                  {formatAmount(r.amounts[c] ?? null)}
                </td>
              ))}
              <td className="px-2 py-1">
                <ConceptCell value={r.member} suggestions={r.memberSuggestions} selected={selected} onAccept={(q) => setMember(r.id, q)} onReject={() => rejectSuggestion(r.id, 'member')} onClear={() => setMember(r.id, '')} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Texts() {
  const { texts, addTextBlock, updateTextBlock, removeTextBlock, setConcept, rejectSuggestion, selection, select } = useIndas()
  return (
    <div className="flex flex-col gap-2 p-2">
      {texts.length === 0 && <Empty>No note text yet. Add a note, give it its heading and paste its text from the annual report.</Empty>}
      {texts.map((t) => {
        const selected = selection?.id === t.id
        return (
          <section key={t.id} onClick={() => select(t.id)} className={cn('flex flex-col gap-2 rounded-md border p-2', selected ? 'border-accent' : 'border-border')}>
            <div className="grid grid-cols-[1fr_40%_auto] items-start gap-2">
              <Input placeholder="Note heading, e.g. Significant accounting policies" value={t.heading} onChange={(e) => updateTextBlock(t.id, { heading: e.target.value })} />
              <ConceptCell value={t.concept} suggestions={t.suggestions} selected={selected} onAccept={(q) => setConcept(t.id, q)} onReject={() => rejectSuggestion(t.id)} onClear={() => setConcept(t.id, '')} />
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
        )
      })}
      <Button className="self-start" onClick={addTextBlock}>
        <Plus size={14} /> Add note text
      </Button>
    </div>
  )
}
