/**
 * The XBRL Form of an Ind AS filing (ADR-0017): the Filing Explorer's ELR as its presentation tree, with the facts the
 * tagged lines make (exact decimals from main) and a chip per value linking back to its canonical cell. Click a tagged
 * line → its cell in Excel; double-click a concept → tags the line selected in Excel with it. Tables and text blocks
 * open their own grids. The Difference footer is the shared one.
 */
import { ChevronDown, ChevronRight, CircleSlash, FileCode2, ListChecks, Loader2 } from 'lucide-react'
import { memo, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LINE_SHEETS, type StatementKey, type TransformResult } from '@shared/indas'
import { useIndasElrs } from '@/app/workspace'
import { Loading, ProgressLine } from '@/components/Loading'
import { Button, Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useUi } from '@/stores/ui'
import { CellChip } from '@/features/xbrl/CellChip'
import { DifferenceFooter } from '@/features/xbrl/DifferenceFooter'
import { useFormTree } from '@/features/xbrl/form-tree'
import { TableTagging } from './TableTagging'
import { emptyMandatory, emptyMasterCount, formLines, rowCells, showAmount, taggedOf, treeOf, type FormLine, type IndasElr } from './workspace'

export function IndasFormView() {
  const elrs = useIndasElrs()
  const activeElr = useIndas((s) => s.activeElr)
  const setActiveElr = useIndas((s) => s.setActiveElr)
  // a big statement renders in the background: the select answers at once, a line shows while the old one stays
  const shownElr = useDeferredValue(activeElr)
  const entry = elrs.find((e) => e.uri === shownElr)
  return (
    <div className="relative flex h-full flex-col outline-none" data-testid="form-view">
      <ProgressLine active={shownElr !== activeElr} delayMs={120} className="absolute inset-x-0 top-0 z-20" />
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
        <Select className="h-7 w-auto min-w-48 flex-1 basis-56 text-xs" value={activeElr ?? ''} onChange={(e) => setActiveElr(e.target.value)} aria-label="Statement" data-testid="indas-elr-select">
          {!activeElr && <option value="">Loading the taxonomy…</option>}
          {elrs.map((e) => (
            <option key={e.uri} value={e.uri}>
              {e.code && !e.code.startsWith('[') ? `[${e.code}] ` : ''}
              {e.title}
            </option>
          ))}
        </Select>
        <FormActions entry={entry} />
      </div>
      {!entry ? (
        <Loading label="Loading the taxonomy…" />
      ) : entry.kind === 'socie' || entry.kind === 'ppe' || entry.kind === 'texts' ? (
        <div className="min-h-0 flex-1">
          <TableTagging kind={entry.kind} />
        </div>
      ) : (
        <LineForm entry={entry} kind={entry.kind as StatementKey} />
      )}
    </div>
  )
}

/** Empty mandatory → 0 · Mandatory items · Generate XML (Auto-tag applies its tags itself: no Accept step). */
function FormActions({ entry }: { entry: IndasElr | undefined }) {
  const s = useIndas(
    useShallow((x) => ({
      trees: x.trees, checks: x.checks, rows: x.rows, socie: x.socie, ppe: x.ppe, fields: x.fields, company: x.company, auditor: x.auditor,
      busy: x.busy, transform: x.transform, fillMandatoryZeros: x.fillMandatoryZeros, setMastersOpen: x.setMastersOpen, generate: x.generate,
    })),
  )
  const isLines = !!entry && LINE_SHEETS.some((l) => l.key === entry.kind)
  const { trees, checks, rows, socie, ppe } = s
  const emptyCount = useMemo(() => {
    const tree = treeOf(trees, entry)
    if (!tree || !isLines) return 0
    const kind = entry!.kind as StatementKey
    return emptyMandatory(formLines(tree, checks[kind]?.facts ?? {}, taggedOf(kind, { rows, socie, ppe }))).length
  }, [trees, checks, rows, socie, ppe, entry, isLines])
  const mastersEmpty = emptyMasterCount(s.fields, s.company, s.auditor)
  return (
    <>
      <Button
        variant="ghost"
        className="h-7 shrink-0 px-2 text-[11px]"
        disabled={!isLines || emptyCount === 0}
        onClick={s.fillMandatoryZeros}
        title="Report the mandatory amounts this statement leaves empty (lines the company doesn't have) as 0."
        data-testid="indas-zero-fill"
      >
        <CircleSlash size={13} /> Empty mandatory → {emptyCount}
      </Button>
      <Button
        variant="ghost"
        className={cn('h-7 shrink-0 px-2 text-[11px]', mastersEmpty > 0 && 'text-warn')}
        onClick={() => s.setMastersOpen(true)}
        title="The mandatory company and auditor details and the signatories (Filing → Company & auditor details)."
        data-testid="mandatory-items"
      >
        <ListChecks size={13} /> Mandatory items{mastersEmpty > 0 ? ` (${mastersEmpty})` : ''}
      </Button>
      <Button variant="primary" className="h-7 shrink-0 px-2 text-[11px]" disabled={!!s.busy || !s.transform} onClick={() => void s.generate()} title="Validate and generate the AOC-4 XML (Filing → Generate XML)" data-testid="indas-generate">
        {s.busy?.startsWith('Validating') ? <Loader2 size={13} className="animate-spin" /> : <FileCode2 size={13} />} Generate XML
      </Button>
    </>
  )
}

function LineForm({ entry, kind }: { entry: IndasElr; kind: StatementKey }) {
  const s = useIndas(
    useShallow((x) => ({ trees: x.trees, checks: x.checks, rows: x.rows, socie: x.socie, ppe: x.ppe, details: x.details, selection: x.selection, focus: x.focus, transform: x.transform })),
  )
  const tree = treeOf(s.trees, entry)
  const check = s.checks[kind]
  const { rows, socie, ppe } = s
  const lines = useMemo(() => (tree ? formLines(tree, check?.facts ?? {}, taggedOf(kind, { rows, socie, ppe })) : []), [tree, check, kind, rows, socie, ppe])
  const foldable = useMemo(() => ({ elrUri: entry.uri, rows: lines.map((l) => l.node), tables: [] }), [entry.uri, lines])
  const fold = useFormTree(tree ? foldable : null)
  const body = useRef<HTMLDivElement>(null)
  const hasPy = s.details?.py !== null
  const selectedRow = s.rows.find((r) => r.id === s.selection?.id) ?? null
  const selectedId = s.selection?.id ?? null
  const canTag = s.selection?.field === 'concept'
  const suggested = useMemo(() => (selectedRow && !selectedRow.concept ? selectedRow.suggestions.map((x) => x.qname) : NONE), [selectedRow])

  // a cell selected in Excel: its fact's row comes into view (folded heads open first)
  useEffect(() => {
    const concept = s.focus?.concept
    const index = concept ? lines.findIndex((l) => l.node.qname === concept) : -1
    if (index < 0) return
    fold.reveal({ row: index }, () => {
      void body.current?.querySelector<HTMLElement>(`tr[data-concept="${CSS.escape(concept!)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.focus?.seq, lines.length])

  if (!tree) return <Loading label="Loading the statement…" />
  const difference = check?.byElr[entry.code] ?? { cy: '0', py: '0', issues: 0 }
  return (
    <>
      <div ref={body} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="form-table">
          <thead className="sticky top-0 z-10 bg-panel-2 text-[11px] text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Particulars</th>
              <th className="w-40 px-3 py-1.5 text-right font-medium">Current year</th>
              {hasPy && <th className="w-40 px-3 py-1.5 text-right font-medium">Previous year</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) =>
              fold.hidden[i] ? null : (
                <LineRow
                  key={`${l.node.qname}-${i}`}
                  line={l}
                  hasPy={hasPy}
                  fold={fold.parents.has(i) ? (fold.collapsed.has(i) ? 'closed' : 'open') : null}
                  index={i}
                  onFold={fold.toggleRow}
                  selectedConcept={selectedRow?.concept ?? null}
                  suggested={suggested}
                  selectedRowId={selectedId}
                  transform={s.transform}
                  canTag={canTag}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
      <DifferenceFooter difference={difference} hasPy={hasPy} onShow={() => useUi.getState().setBottomTab('problems')} />
    </>
  )
}

const NONE: string[] = []

/** One Form row. Memoised and store-free: a click re-renders only the rows whose selection state changed. */
const LineRow = memo(function LineRow(props: {
  line: FormLine
  hasPy: boolean
  fold: 'open' | 'closed' | null
  index: number
  onFold(index: number): void
  selectedConcept: string | null
  suggested: string[]
  selectedRowId: string | null
  transform: TransformResult | null
  canTag: boolean
}) {
  const { line: l, transform } = props
  const { revealRow, tagFromTree } = useIndas.getState()
  const n = l.node
  const indent = { paddingLeft: `${1.25 + n.depth * 0.9}rem` }
  const foldButton = props.fold && (
    <button
      className="mr-0.5 -ml-3.5 inline-flex w-3 align-middle text-muted hover:text-fg"
      onClick={(e) => (e.stopPropagation(), props.onFold(props.index))}
      aria-expanded={props.fold === 'open'}
      data-testid="form-fold"
    >
      {props.fold === 'open' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  )
  if (n.abstract) {
    return (
      <tr className="border-b border-border/50" data-concept={n.qname}>
        <td colSpan={props.hasPy ? 3 : 2} style={indent} className="py-1 pr-3 font-semibold">
          {foldButton}
          {n.label}
        </td>
      </tr>
    )
  }
  const active = n.qname === props.selectedConcept || (!!props.selectedRowId && l.rows.includes(props.selectedRowId))
  const suggested = !active && props.suggested.includes(n.qname)
  const first = l.rows[0]
  const cells = first && transform ? rowCells(transform, first) : null
  const chip = (year: 'cy' | 'py') => {
    const cell = cells?.[year]
    if (!cell || !first) return first?.startsWith('zero:') ? <span className="rounded bg-panel-2 px-1 text-[10px] text-muted" title="Reported as 0 (Empty mandatory → 0)">0</span> : null
    const more = l.rows.length > 1 ? ` +${l.rows.length - 1}` : ''
    return (
      <CellChip
        text={`${cell.ref}${more}`}
        active={props.selectedRowId === first}
        title={`From ${cell.sheet}!${cell.ref}${more ? ` and ${l.rows.length - 1} more line(s) (added up)` : ''}\nClick to show it in Excel`}
        onClick={() => revealRow(first, year)}
      />
    )
  }
  const tagHere = () => {
    if (props.canTag) tagFromTree(n)
  }
  return (
    <tr
      className={cn('scroll-mt-9 scroll-mb-2 border-b border-border/50 hover:bg-panel-2', active && 'bg-accent/10', suggested && 'bg-warn/10')}
      data-concept={n.qname}
      data-testid="form-row"
      data-tagged={l.rows.length > 0 || undefined}
      onClick={() => first && revealRow(first, 'label')}
      onDoubleClick={tagHere}
      title={`${n.qname}${n.periodType ? ` · ${n.periodType}` : ''}\n${props.selectedRowId ? 'Double-click to tag the selected line with this concept' : 'Select a line in Excel, then double-click its concept here'}`}
    >
      <td style={indent} className="py-1 pr-3">
        {foldButton}
        <span className={cn(l.tone === 'ok' && 'text-ok', l.tone === 'bad' && 'text-err')} data-testid="row-label" data-tone={l.tone ?? undefined}>
          {n.label}
        </span>
        {suggested && <span className="ml-1.5 rounded bg-warn/20 px-1 text-[10px] text-warn">suggested</span>}
      </td>
      <td className="px-3 py-1 text-right">
        <span className="tabular inline-flex items-center gap-1.5">
          {chip('cy')}
          <span>{showAmount(l.value?.cy)}</span>
        </span>
      </td>
      {props.hasPy && (
        <td className="px-3 py-1 text-right">
          <span className="tabular inline-flex items-center gap-1.5">
            {chip('py')}
            <span>{showAmount(l.value?.py)}</span>
          </span>
        </td>
      )}
    </tr>
  )
})
