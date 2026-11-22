/**
 * The Excel pane of an Ind AS filing (ADR-0017): the canonical sheets (the standard template's layout, as
 * /indas/transform returns them) in the shared Univer grid, coloured by tag status. Clicking a line selects it for
 * tagging and shows its fact in the XBRL Form; the inspector below accepts / rejects its suggestion.
 */
import { Download, FileSpreadsheet, Loader2, Sparkles, Upload } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CellRef } from '@shared/workbook'
import { EmptyState } from '@/components/EmptyState'
import { Loading } from '@/components/Loading'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import type { GridMarks } from '@/features/excel/UniverGrid'
import { ConceptCell, PeriodRoleSelect } from './ConceptCell'
import { autoTagRemaining, formatAmount } from './model'
import { rowCells, statusMarks } from './workspace'

// Univer is large: load it only when a workbook is shown
const UniverGrid = lazy(() => import('@/features/excel/UniverGrid').then((m) => ({ default: m.UniverGrid })))

export function IndasExcelPane() {
  const { workbook, transform, busy, upload, saveTemplate, autoTag, rows, socie, ppe, texts } = useIndas(
    useShallow((s) => ({ workbook: s.workbook, transform: s.transform, busy: s.busy, upload: s.upload, saveTemplate: s.saveTemplate, autoTag: s.autoTag, rows: s.rows, socie: s.socie, ppe: s.ppe, texts: s.texts })),
  )
  // after a cancelled run some lines have suggestions and some don't: the button continues with the rest
  const left = useMemo(() => autoTagRemaining({ rows, socie, ppe, texts }), [rows, socie, ppe, texts])
  const started = rows.some((r) => r.suggestions.length > 0)
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Excel workbook" data-testid="indas-excel">
      <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-panel-2 text-xs">
        <span className="flex items-center gap-2 px-3 text-muted">
          <FileSpreadsheet size={14} /> Excel
        </span>
        {transform && (
          <span className="flex max-w-56 items-center gap-1.5 truncate border-l border-border bg-panel px-3 text-fg" title={transform.fileName}>
            <span className="truncate">{transform.fileName}</span>
            <span className={cn('shrink-0 rounded px-1 text-[10px]', transform.source === 'standard_template' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>
              {transform.source === 'standard_template' ? 'template' : 'converted'}
            </span>
          </span>
        )}
        <div className="flex-1" />
        {busy && (
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2 text-muted" aria-live="polite" data-testid="indas-busy">
            <Loader2 size={12} className="animate-spin" /> {busy}
          </span>
        )}
        <ToolbarButton onClick={() => void upload()} disabled={!!busy} title="Open the client's financial statements (.xls / .xlsx) or a filled standard template" testId="indas-upload">
          <Upload size={12} /> {transform ? 'Replace…' : 'Open financial statements…'}
        </ToolbarButton>
        <ToolbarButton onClick={() => void saveTemplate()} disabled={!!busy} title="Save the standard template (six canonical sheets) to fill by hand or with any AI tool" testId="indas-template">
          <Download size={12} /> Template
        </ToolbarButton>
        {transform && (
          <ToolbarButton onClick={() => void autoTag()} disabled={!!busy} title="Tag every line (each sheet from its own taxonomy scope): each untagged line takes its best suggestion; change any tag afterwards. Only line names and headings go to the AI." testId="auto-tag">
            <Sparkles size={12} /> {started && left > 0 ? `Continue auto-tag (${left} left)` : 'Auto-tag'}
          </ToolbarButton>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {workbook ? (
          <ErrorBoundary key={workbook.fileName} what="The Excel view">
            <Suspense fallback={<Loading label="Loading the workbook…" />}>
              <CanonicalGrid />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <EmptyState icon={FileSpreadsheet} title="No financial statements yet">
            <p>Open the client&apos;s Excel (.xls / .xlsx). It is converted into the six standard sheets; a filled standard template is read exactly as it is.</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button variant="primary" disabled={!!busy} onClick={() => void upload()} data-testid="indas-upload-empty">
                <Upload size={14} /> Open financial statements…
              </Button>
              <Button disabled={!!busy} onClick={() => void saveTemplate()}>
                <Download size={14} /> Save standard template…
              </Button>
            </div>
          </EmptyState>
        )}
      </div>
      {workbook && <LineInspector />}
    </section>
  )
}

function ToolbarButton(props: { onClick(): void; disabled?: boolean; title: string; testId: string; children: React.ReactNode }) {
  return (
    <button
      className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg disabled:opacity-50"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  )
}

/** The canonical workbook with the tag overlay: green = tagged, amber = suggestion waiting, blue = the selected line. */
function CanonicalGrid() {
  const { workbook, transform, rows, socie, ppe, selection, reveal, selectCell, showSheet } = useIndas(
    useShallow((s) => ({ workbook: s.workbook, transform: s.transform, rows: s.rows, socie: s.socie, ppe: s.ppe, selection: s.selection, reveal: s.reveal, selectCell: s.selectCell, showSheet: s.showSheet })),
  )
  // the status colours don't change with the selection: a click redraws only the selected line's layer
  const status = useMemo(() => (transform ? statusMarks(transform, rows, socie, ppe) : null), [transform, rows, socie, ppe])
  const linked = useMemo(() => {
    const sel = transform && selection ? rowCells(transform, selection.id) : null
    return sel ? [sel.label, sel.cy, sel.py].filter((x): x is CellRef => !!x) : []
  }, [transform, selection])
  const marks = useMemo<GridMarks>(() => ({ approved: status?.approved ?? [], suggested: status?.suggested ?? [], linked }), [status, linked])
  const selected = linked[0] ?? null
  if (!workbook) return null
  return <UniverGrid model={workbook} marks={marks} reveal={reveal} selected={selected} onSelect={(cell) => selectCell(cell)} onSheetChange={showSheet} />
}

/** The selected line: its amounts, its suggestion (✓ accept / ✗ next) and, for an instant concept, opening or closing. */
function LineInspector() {
  const { selection, rows, socie, ppe, setConcept, setMember, rejectSuggestion, setPeriodRole } = useIndas(
    useShallow((s) => ({ selection: s.selection, rows: s.rows, socie: s.socie, ppe: s.ppe, setConcept: s.setConcept, setMember: s.setMember, rejectSuggestion: s.rejectSuggestion, setPeriodRole: s.setPeriodRole })),
  )
  const row = rows.find((r) => r.id === selection?.id)
  const so = socie.find((r) => r.id === selection?.id)
  const pp = ppe.find((r) => r.id === selection?.id)
  const hint = 'Double-click a concept in the XBRL Form (or click one in Taxonomy) to tag the selected line.'
  return (
    <div className="flex shrink-0 items-start gap-3 border-t border-border bg-panel-2 px-3 py-2 text-[12px]" data-testid="indas-inspector" data-row={selection?.id ?? ''}>
      {row ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" title={row.breadcrumb}>
              {row.label}
            </div>
            <div className="truncate text-[11px] text-muted">
              {row.breadcrumb.split(' > ').slice(0, -1).join(' › ') || '—'} · CY {formatAmount(row.cy) || '—'} · PY {formatAmount(row.py) || '—'}
            </div>
          </div>
          <div className="w-[45%] shrink-0">
            <ConceptCell value={row.concept} suggestions={row.suggestions} selected onAccept={(q) => setConcept(row.id, q)} onReject={() => rejectSuggestion(row.id)} onClear={() => setConcept(row.id, '')} />
            <PeriodRoleSelect concept={row.concept} suggestions={row.suggestions} value={row.periodRole} onChange={(role) => setPeriodRole(row.id, role)} />
          </div>
        </>
      ) : so ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{so.description}</div>
            <div className="truncate text-[11px] text-muted">{so.component} · Changes in equity [T] (open it in the Filing Explorer)</div>
          </div>
          <div className="flex w-[45%] shrink-0 flex-col gap-1">
            <ConceptCell value={so.member} suggestions={so.memberSuggestions} selected onAccept={(q) => setMember(so.id, q)} onReject={() => rejectSuggestion(so.id, 'member')} onClear={() => setMember(so.id, '')} />
            <ConceptCell value={so.concept} suggestions={so.suggestions} selected onAccept={(q) => setConcept(so.id, q)} onReject={() => rejectSuggestion(so.id)} onClear={() => setConcept(so.id, '')} />
          </div>
        </>
      ) : pp ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{pp.assetClass}</div>
            <div className="truncate text-[11px] text-muted">Fixed assets [T]: the class is a member of the PPE classes axis</div>
          </div>
          <div className="w-[45%] shrink-0">
            <ConceptCell value={pp.member} suggestions={pp.memberSuggestions} selected onAccept={(q) => setMember(pp.id, q)} onReject={() => rejectSuggestion(pp.id, 'member')} onClear={() => setMember(pp.id, '')} />
          </div>
        </>
      ) : (
        <div className="py-1 text-[11px] text-muted">Click a line in the sheets to tag it. {hint}</div>
      )}
    </div>
  )
}
