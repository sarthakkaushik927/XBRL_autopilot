/**
 * The table [T] and text-block [E] tagging grids of an Ind AS filing (docs/15 §5), shown in the XBRL Form when the
 * Filing Explorer opens Changes in equity, Fixed assets or Notes text. Their taxonomy tree is the TaxonomyPane beside.
 */
import { Plus, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { PPE_TABLE, SOCIE_TABLE, TEXT_BLOCKS_SCOPE, type ConceptSuggestion } from '@shared/indas'
import { Button, Input } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { ConceptCell, PeriodRoleSelect } from './ConceptCell'
import { formatAmount } from './model'
import { TaxonomyPane } from './TaxonomyPane'

function Empty(props: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-muted">{props.children}</p>
}

/** Grid on the left, the scope's taxonomy (or axis members) on the right. */
export function TableTagging({ kind }: { kind: 'socie' | 'ppe' | 'texts' }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,3fr)_minmax(220px,2fr)] gap-2 p-2">
      <div className="min-h-0 overflow-auto rounded-md border border-border bg-panel">{kind === 'socie' ? <Socie /> : kind === 'ppe' ? <Ppe /> : <Texts />}</div>
      <TablePane kind={kind} />
    </div>
  )
}

/** The right pane follows the selected field (component member or movement concept). */
function TablePane({ kind }: { kind: 'socie' | 'ppe' | 'texts' }) {
  const s = useIndas(useShallow((x) => ({ selection: x.selection, socie: x.socie, ppe: x.ppe, texts: x.texts })))
  const sel = s.selection
  const tagged = new Map<string, number>()
  const count = (q: string) => q && tagged.set(q, (tagged.get(q) ?? 0) + 1)
  let scope: string = SOCIE_TABLE.sheet
  let field: 'concept' | 'member' = 'concept'
  let title: string
  let current = ''
  let suggested: ConceptSuggestion[] = []
  if (kind === 'socie') {
    field = sel?.field === 'member' ? 'member' : 'concept'
    title = field === 'member' ? 'Components of equity (members)' : 'Changes in equity — concepts'
    s.socie.forEach((r) => count(field === 'member' ? r.member : r.concept))
    const r = s.socie.find((x) => x.id === sel?.id)
    current = (field === 'member' ? r?.member : r?.concept) ?? ''
    suggested = (field === 'member' ? r?.memberSuggestions : r?.suggestions) ?? []
  } else if (kind === 'ppe') {
    scope = PPE_TABLE.sheet
    field = 'member'
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
  return <TaxonomyPane scope={scope} kind={field} title={title} tagged={tagged} current={current} suggested={suggested.map((x) => x.qname)} />
}

function Socie() {
  const { socie, selection, select, revealRow, setConcept, setMember, rejectSuggestion, setPeriodRole } = useIndas(
    useShallow((x) => ({ socie: x.socie, selection: x.selection, select: x.select, revealRow: x.revealRow, setConcept: x.setConcept, setMember: x.setMember, rejectSuggestion: x.rejectSuggestion, setPeriodRole: x.setPeriodRole })),
  )
  if (socie.length === 0) return <Empty>No changes-in-equity rows with amounts. Open the financial statements first.</Empty>
  return (
    <table className="w-full text-[12px]" data-testid="indas-socie">
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
              <td className="cursor-pointer px-2 py-1" onClick={() => revealRow(r.id, 'label')} title="Show in Excel">
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

const PPE_COLUMNS: [string, string][] = [
  ['Gross_Opening', 'Gross opening'],
  ['Gross_Additions', 'Additions'],
  ['Gross_Disposals', 'Disposals'],
  ['Gross_Closing', 'Gross closing'],
  ['Dep_Closing', 'Acc. dep.'],
  ['Net_Current_Year', 'Net CY'],
]

function Ppe() {
  const { ppe, selection, revealRow, setMember, rejectSuggestion } = useIndas(
    useShallow((x) => ({ ppe: x.ppe, selection: x.selection, revealRow: x.revealRow, setMember: x.setMember, rejectSuggestion: x.rejectSuggestion })),
  )
  if (ppe.length === 0) return <Empty>No fixed-asset classes in this workbook.</Empty>
  return (
    <table className="w-full text-[12px]" data-testid="indas-ppe">
      <thead className="sticky top-0 z-10 bg-panel-2 text-left text-muted">
        <tr>
          <th className="px-2 py-1.5 font-medium">Asset class</th>
          {PPE_COLUMNS.map(([, t]) => (
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
            <tr key={r.id} onClick={() => revealRow(r.id, 'label')} className={cn('cursor-pointer border-t border-border/60 align-top', selected ? 'bg-accent/10' : 'hover:bg-panel-2', !r.member && !selected && 'bg-warn/5')}>
              <td className="px-2 py-1">{r.assetClass}</td>
              {PPE_COLUMNS.map(([c]) => (
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
  const { texts, addTextBlock, updateTextBlock, removeTextBlock, setConcept, rejectSuggestion, selection, select } = useIndas(
    useShallow((x) => ({ texts: x.texts, addTextBlock: x.addTextBlock, updateTextBlock: x.updateTextBlock, removeTextBlock: x.removeTextBlock, setConcept: x.setConcept, rejectSuggestion: x.rejectSuggestion, selection: x.selection, select: x.select })),
  )
  return (
    <div className="flex flex-col gap-2 p-2" data-testid="indas-texts">
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
