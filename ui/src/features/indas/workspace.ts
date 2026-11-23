/**
 * The Ind AS filing as the editor panes see it (ADR-0017): pure functions, no React, no IPC (ui/test/indas-workspace.test.ts).
 *
 * - The Excel pane shows the canonical sheets (the standard template's layout, what /indas/transform returns), so a
 *   taggable line is exactly one grid row: canonical row i of a sheet = grid row i + 1 (row 0 is the header). The
 *   cell ↔ tag link needs no guessing.
 * - The Filing Explorer lists the ELRs of each canonical sheet's scope (/indas/tree/{scope}), grouped by the sheet
 *   that tags them — never by ELR code.
 * - The XBRL Form is an ELR's presentation tree with the facts the tagged lines make (exact decimals from main).
 */
import { formatIndian } from '@xap/engine/basics'
import {
  CANONICAL_SHEETS,
  LINE_SHEETS,
  PPE_TABLE,
  SOCIE_TABLE,
  TEXT_BLOCKS_SCOPE,
  type CheckResult,
  type DerivedTotal,
  type FactValue,
  type FixProblem,
  type GenerateXmlResult,
  type IndasDetails,
  type MasterFields,
  type SheetTree,
  type StatementKey,
  type TransformResult,
  type TreeNode,
} from '@shared/indas'
import type { ElrInfo } from '@shared/project'
import { columnLetter, type CellModel, type CellRef, type SheetModel, type WorkbookModel } from '@shared/workbook'
import { ppeFromTransform, rowsFromTransform, socieFromTransform, type PpeRow, type Readiness, type SocieRow, type TagRow, type TextBlockRow } from './model'

/** The source id of the canonical workbook in the Excel pane. */
export const CANONICAL_SOURCE = 'canonical'

/** What a row of the canonical sheets is tagged as: a statement's lines, or one of the two tables. */
export type RowKind = StatementKey | 'socie' | 'ppe'

/** Per row kind: its sheet, its label column and its CY / PY amount columns. */
const ROW_SHEETS: Record<RowKind, { sheet: string; label: string; cy: string; py: string }> = {
  ...(Object.fromEntries(LINE_SHEETS.map((s) => [s.key, { sheet: s.sheet, label: 'Line_Item', cy: 'Current_Year_Amount', py: 'Previous_Year_Amount' }])) as Record<
    StatementKey,
    { sheet: string; label: string; cy: string; py: string }
  >),
  socie: { sheet: SOCIE_TABLE.sheet, label: 'Transaction_Description', cy: 'Current_Year_Amount', py: 'Previous_Year_Amount' },
  ppe: { sheet: PPE_TABLE.sheet, label: 'Asset_Class', cy: 'Net_Current_Year', py: 'Net_Previous_Year' },
}

/** A sheet's columns in their order (every row's keys, first appearance first). */
export function sheetColumns(t: TransformResult, sheet: string): string[] {
  const cols: string[] = []
  for (const r of t.sheets[sheet] ?? []) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  return cols
}

/** One edited cell of the canonical sheets (0-based row and column; row 0 is the header). */
export interface SheetEdit {
  sheet: string
  row: number
  column: number
  value: string | number | boolean | null
}

type EditableWork = { transform: TransformResult; rows: TagRow[]; socie: SocieRow[]; ppe: PpeRow[] }

/**
 * The work after the user edited cells of the canonical sheets (issue #20, point 1): the sheet rows take the new
 * values, and every line, changes-in-equity row and PPE row is read again from them, so its amounts and label follow
 * the cell. What the user decided stays: tags, members, suggestions and opening / closing. A line that gets an amount
 * appears (untagged); one that loses both amounts goes, as when the workbook is read. Header-row edits, cells outside
 * the sheet's rows and columns, and unchanged values are ignored; null = nothing changed.
 */
export function withCellEdits(w: EditableWork, edits: readonly SheetEdit[]): EditableWork | null {
  const sheets = { ...w.transform.sheets }
  let changed = false
  for (const e of edits) {
    const rows = sheets[e.sheet]
    const column = rows ? sheetColumns(w.transform, e.sheet)[e.column] : undefined
    const index = e.row - 1
    if (!rows || !column || index < 0 || index >= rows.length) continue
    const value = typeof e.value === 'string' && e.value.trim() === '' ? null : e.value
    if ((rows[index]![column] ?? null) === value) continue
    if (rows === w.transform.sheets[e.sheet]) sheets[e.sheet] = [...rows]
    sheets[e.sheet]![index] = { ...sheets[e.sheet]![index], [column]: value }
    changed = true
  }
  if (!changed) return null
  const transform = { ...w.transform, sheets }
  const keep = <T extends { id: string }>(fresh: T[], old: readonly T[], read: (f: T) => Partial<T>): T[] => {
    const byId = new Map(old.map((r) => [r.id, r]))
    const freshIds = new Set(fresh.map((r) => r.id))
    // rows that aren't sheet rows (e.g. mandatory amounts reported as 0) stay as they are
    const extra = old.filter((r) => !parseRowId(r.id) && !freshIds.has(r.id))
    return [...fresh.map((f) => (byId.has(f.id) ? { ...byId.get(f.id)!, ...read(f) } : f)), ...extra]
  }
  return {
    transform,
    rows: keep(rowsFromTransform(transform), w.rows, (f) => ({ label: f.label, breadcrumb: f.breadcrumb, note: f.note, cy: f.cy, py: f.py })),
    socie: keep(socieFromTransform(transform), w.socie, (f) => ({ component: f.component, description: f.description, cy: f.cy, py: f.py })),
    ppe: keep(ppeFromTransform(transform), w.ppe, (f) => ({ assetClass: f.assetClass, amounts: f.amounts })),
  }
}

/** The canonical sheets as a read-only workbook for the Univer grid: a bold header row, then the rows as given. */
export function canonicalWorkbook(t: TransformResult): WorkbookModel {
  const names = [...CANONICAL_SHEETS.filter((s) => s in t.sheets), ...Object.keys(t.sheets).filter((s) => !(CANONICAL_SHEETS as readonly string[]).includes(s))]
  const sheets: SheetModel[] = names.map((name) => {
    const cols = sheetColumns(t, name)
    const rows = t.sheets[name] ?? []
    const cells: CellModel[] = cols.map((c, ci) => ({ r: 0, c: ci, v: c, bold: true }))
    const widths: Record<number, number> = Object.fromEntries(cols.map((c, ci) => [ci, Math.min(60, Math.max(10, c.length + 2))]))
    rows.forEach((row, ri) =>
      cols.forEach((c, ci) => {
        const v = row[c]
        if (v === null || v === undefined || v === '') return
        cells.push({ r: ri + 1, c: ci, v })
        widths[ci] = Math.min(60, Math.max(widths[ci] ?? 10, String(v).length + 2))
      }),
    )
    return { name, rowCount: rows.length + 1, colCount: cols.length, cells, merges: [], colWidths: widths }
  })
  return { source: CANONICAL_SOURCE, fileName: t.fileName, sheets }
}

/** "balanceSheet:4" → its kind and its index in the canonical sheet (null for rows that have no sheet row). */
export function parseRowId(id: string): { kind: RowKind; index: number } | null {
  const m = /^([a-zA-Z]+):(\d+)$/.exec(id)
  if (!m || !(m[1]! in ROW_SHEETS)) return null
  return { kind: m[1] as RowKind, index: Number(m[2]) }
}

export interface RowCells {
  sheet: string
  label: CellRef | null
  cy: CellRef | null
  py: CellRef | null
}

/** Where a taggable row sits in the canonical workbook. */
export function rowCells(t: TransformResult, id: string): RowCells | null {
  const p = parseRowId(id)
  if (!p) return null
  const def = ROW_SHEETS[p.kind]
  const cols = sheetColumns(t, def.sheet)
  const at = (col: string): CellRef | null => {
    const c = cols.indexOf(col)
    return c < 0 ? null : { workbook: CANONICAL_SOURCE, sheet: def.sheet, ref: `${columnLetter(c)}${p.index + 2}` }
  }
  return { sheet: def.sheet, label: at(def.label), cy: at(def.cy), py: at(def.py) }
}

/** The grid's tag colours: green = tagged, amber = a suggestion waiting (label, CY and PY cells of each line). */
export function statusMarks(
  t: TransformResult,
  rows: readonly TagRow[],
  socie: readonly SocieRow[],
  ppe: readonly PpeRow[],
): { approved: CellRef[]; suggested: CellRef[] } {
  const out = { approved: [] as CellRef[], suggested: [] as CellRef[] }
  const add = (id: string, status: 'approved' | 'suggested' | null) => {
    const c = status ? rowCells(t, id) : null
    if (c) out[status!].push(...[c.label, c.cy, c.py].filter((x): x is CellRef => !!x))
  }
  for (const r of rows) add(r.id, r.concept ? 'approved' : r.suggestions.length ? 'suggested' : null)
  for (const r of socie) add(r.id, r.concept && r.member ? 'approved' : r.suggestions.length ? 'suggested' : null)
  for (const r of ppe) add(r.id, r.member ? 'approved' : r.memberSuggestions.length ? 'suggested' : null)
  return out
}

/** The taggable row a clicked cell belongs to (any cell of its grid row), else null. */
export function rowIdAt(cell: CellRef, ids: readonly string[]): string | null {
  if (cell.workbook !== CANONICAL_SOURCE) return null
  const m = /^[A-Z]+(\d+)/.exec(cell.ref)
  if (!m) return null
  const index = Number(m[1]) - 2
  const kinds = (Object.keys(ROW_SHEETS) as RowKind[]).filter((k) => ROW_SHEETS[k].sheet === cell.sheet)
  return ids.find((id) => kinds.some((k) => id === `${k}:${index}`)) ?? null
}

// ------------------------------------------------------------------------------------------------ Filing Explorer

/** The sheets whose taxonomy trees the explorer lists, and the group each sheet's ELRs belong to. */
export const TREE_SCOPES: { scope: string; group: ElrInfo['group']; kind: RowKind | 'texts' }[] = [
  { scope: 'CANONICAL_BS', group: 'Statements', kind: 'balanceSheet' },
  { scope: 'CANONICAL_PL', group: 'Statements', kind: 'profitLoss' },
  { scope: 'CANONICAL_CF', group: 'Statements', kind: 'cashFlow' },
  { scope: SOCIE_TABLE.sheet, group: 'Statements', kind: 'socie' },
  { scope: 'CANONICAL_FINANCIAL_NOTES', group: 'Notes', kind: 'noteLines' },
  { scope: PPE_TABLE.sheet, group: 'Notes', kind: 'ppe' },
]

/** The explorer's own entries beside the ELRs: the notes' text blocks and the company / auditor details. */
export const TEXTS_URI = TEXT_BLOCKS_SCOPE
export const MASTERS_URI = 'MASTERS'

export interface IndasElr extends ElrInfo {
  /** the canonical sheet whose tree holds it ('' for the masters entry) */
  scope: string
  kind: RowKind | 'texts' | 'masters'
}

/** "Balance sheet [Abstract]" → "Balance sheet". */
export const elrTitle = (title: string) => title.replace(/\s*\[(Abstract|Text Block|Table|Line Items)\]\s*$/i, '').trim()

/** The explorer's ELR list from the scopes' trees (each ELR once, in scope order). */
export function explorerElrs(trees: Record<string, SheetTree[]>): IndasElr[] {
  const out: IndasElr[] = []
  for (const s of TREE_SCOPES) {
    for (const t of trees[`${s.scope}:concept`] ?? []) {
      if (out.some((e) => e.code === t.elr)) continue
      out.push({ uri: `${s.scope}#${t.elr}`, code: t.elr, title: elrTitle(t.title), group: s.group, scope: s.scope, kind: s.kind })
    }
  }
  out.push({ uri: TEXTS_URI, code: '[E]', title: 'Notes text blocks', group: 'Notes', scope: TEXT_BLOCKS_SCOPE, kind: 'texts' })
  out.push({ uri: MASTERS_URI, code: '', title: 'Company, auditor & signatories', group: 'Disclosures', scope: '', kind: 'masters' })
  return out
}

/** The tree of an explorer entry (null until its scope is loaded). */
export function treeOf(trees: Record<string, SheetTree[]>, elr: IndasElr | undefined): SheetTree | null {
  if (!elr?.scope || elr.kind === 'texts' || elr.kind === 'masters') return null
  return trees[`${elr.scope}:concept`]?.find((t) => t.elr === elr.code) ?? null
}

/** The explorer entry that shows a row's concept (its statement's ELR holding it), for "select a cell → its fact". */
export function elrOfConcept(elrs: readonly IndasElr[], trees: Record<string, SheetTree[]>, kind: RowKind, concept: string): IndasElr | null {
  const mine = elrs.filter((e) => e.kind === kind)
  return mine.find((e) => treeOf(trees, e)?.nodes.some((n) => n.qname === concept)) ?? mine[0] ?? null
}

// ------------------------------------------------------------------------------------------------ XBRL Form

export interface FormLine {
  node: TreeNode
  value: FactValue | null
  /** the lines tagged with this concept (their rows), first one first */
  rows: string[]
  /** red: mandatory and still empty; green: tagged or calculated */
  tone: 'ok' | 'bad' | null
  /** no line reports it: its value is summed from its parts (issue #20, point 5); their labels */
  derived: { parts: string[]; elr: string } | null
}

/** The ELR's tree with each concept's facts, the lines tagged with it, and the totals summed from their parts. */
export function formLines(
  tree: SheetTree,
  facts: Record<string, FactValue>,
  rows: readonly { id: string; concept: string }[],
  derived: readonly DerivedTotal[] = [],
): FormLine[] {
  const byConcept = new Map<string, string[]>()
  for (const r of rows) if (r.concept) byConcept.set(r.concept, [...(byConcept.get(r.concept) ?? []), r.id])
  const calculated = new Map(derived.map((d) => [d.concept, d]))
  const labelOf = (q: string) => tree.nodes.find((n) => n.qname === q)?.label ?? q.slice(q.indexOf(':') + 1)
  return tree.nodes.map((node) => {
    const tagged = byConcept.get(node.qname) ?? []
    const value = facts[node.qname] ?? null
    const tone = node.abstract ? null : tagged.length || value ? 'ok' : node.mandatory ? 'bad' : null
    const d = !node.abstract && !tagged.length ? calculated.get(node.qname) : undefined
    return { node, value, rows: tagged, tone, derived: d ? { parts: d.parts.map(labelOf), elr: d.elr } : null }
  })
}

/** Mandatory amounts of the tree that nothing reports yet (what "Empty mandatory → 0" fills). */
export function emptyMandatory(lines: readonly FormLine[]): TreeNode[] {
  return lines.filter((l) => l.tone === 'bad' && /monetary/i.test(l.node.type ?? '')).map((l) => l.node)
}

/** Display of a fact value: Indian grouping, blank when there is none. */
export const showAmount = (v: string | null | undefined) => (v == null ? '' : formatIndian(v))

// ------------------------------------------------------------------------------------------------ Problems

/** Where double-clicking a problem goes (PR #15 review, point 9). */
export type ProblemTarget =
  /** the line's cell in Excel (and its fact in the Form) */
  | { kind: 'line'; rowId: string; which: 'label' | 'cy' | 'py' }
  /** a concept no line reports yet: its place in the XBRL Form, to tag it */
  | { kind: 'concept'; concept: string; elr: string | null }
  | { kind: 'masters' }
  | { kind: 'settings' }

export interface IndasProblem {
  severity: 'error' | 'warning'
  source: 'readiness' | 'difference' | 'mca'
  message: string
  target: ProblemTarget | null
  /** what Fix with AI sends about it: only totals that don't add up (company / DIN problems open the dialog) */
  fix?: FixProblem
}

/** The tagged lines the problems can point at. */
export interface ProblemLines {
  rows: readonly Pick<TagRow, 'id' | 'concept' | 'statement'>[]
  socie: readonly Pick<SocieRow, 'id' | 'concept'>[]
  ppe: readonly Pick<PpeRow, 'id' | 'member'>[]
}

const MASTER_PROBLEMS = /^(MANDATORY_COMPANY_INFO_MISSING|INSUFFICIENT_SIGNATORIES|INVALID_DIN)$/

/** A concept's place: the first line tagged with it (preferring the statement's own), else the concept in the Form. */
function conceptTarget(lines: ProblemLines, concept: string, which: 'label' | 'cy' | 'py', elr: string | null, statement?: StatementKey): ProblemTarget {
  const row =
    lines.rows.find((r) => r.concept === concept && (!statement || r.statement === statement)) ??
    lines.rows.find((r) => r.concept === concept) ??
    lines.socie.find((r) => r.concept === concept)
  return row ? { kind: 'line', rowId: row.id, which } : { kind: 'concept', concept, elr }
}

/** Everything the Problems panel lists: readiness, totals that don't add up (by statement), MCA's answer. */
export function problemsOf(input: {
  readiness: readonly Readiness[]
  checks: Partial<Record<StatementKey, CheckResult>>
  result: GenerateXmlResult | null
  lines: ProblemLines
}): IndasProblem[] {
  const out: IndasProblem[] = input.readiness.map((r) => ({ severity: 'warning' as const, source: 'readiness' as const, message: r.message, target: r.fix ? { kind: r.fix } : null }))
  for (const st of LINE_SHEETS) {
    for (const d of input.checks[st.key]?.differences ?? []) {
      const message = `${st.title} · ${d.year}: ${d.label} ${formatIndian(d.reported)} ≠ ${formatIndian(d.calculated)} (difference ${formatIndian(d.difference)})`
      out.push({
        severity: 'error',
        source: 'difference',
        message,
        target: conceptTarget(input.lines, d.concept, d.year === 'CY' ? 'cy' : 'py', d.elr, st.key),
        fix: { id: `${st.key}:${d.year}:${d.concept}:${d.label}`, message, concept: d.concept, elr: d.elr, year: d.year, statement: st.key },
      })
    }
  }
  if (input.result && !input.result.ok) {
    for (const e of input.result.errors) {
      const member = e.member ? input.lines.ppe.find((r) => r.member === e.member) : undefined
      const target: ProblemTarget | null = MASTER_PROBLEMS.test(e.type ?? '')
        ? { kind: 'masters' }
        : member
          ? { kind: 'line', rowId: member.id, which: 'label' }
          : e.concept
            ? conceptTarget(input.lines, e.concept, 'cy', null)
            : null
      out.push({ severity: 'error', source: 'mca', message: e.type ? `${e.type}: ${e.message}` : e.message, target })
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------ Filing settings

/** How many mandatory company / auditor fields are still empty. */
export function emptyMasterCount(fields: MasterFields | null, company: Record<string, string>, auditor: Record<string, string>): number {
  if (!fields) return 0
  const empty = (list: MasterFields['company'], values: Record<string, string>) => list.filter((f) => !(values[f.qname] ?? '').trim()).length
  return empty(fields.company, company) + empty(fields.auditor, auditor)
}

// ------------------------------------------------------------------------------------------------ Preview

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** An MCA-like preview of the tagged statements (sandboxed iframe, no scripts): one table per ELR with values. */
export function previewHtml(d: IndasDetails, sections: { title: string; code: string; lines: FormLine[] }[], texts: readonly TextBlockRow[]): string {
  const hasPy = d.py !== null
  const body = sections
    .map((s) => {
      const shown = s.lines.filter((l) => l.node.abstract || l.value)
      if (!shown.some((l) => l.value)) return ''
      const rows = shown
        .map((l) => {
          const pad = `padding-left:${0.4 + l.node.depth * 0.9}em`
          if (l.node.abstract) return `<tr><td style="${pad}"><b>${esc(l.node.label)}</b></td><td></td>${hasPy ? '<td></td>' : ''}</tr>`
          return `<tr><td style="${pad}">${esc(l.node.label)}</td><td class="n">${esc(showAmount(l.value?.cy))}</td>${hasPy ? `<td class="n">${esc(showAmount(l.value?.py))}</td>` : ''}</tr>`
        })
        .join('')
      return `<h2>[${esc(s.code)}] ${esc(s.title)}</h2><table><tr><th>Particulars</th><th>Current year</th>${hasPy ? '<th>Previous year</th>' : ''}</tr>${rows}</table>`
    })
    .join('')
  const notes = texts
    .filter((t) => t.concept && t.content.trim())
    .map((t) => `<h3>${esc(t.heading || t.concept)}</h3><p>${esc(t.content).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12px/1.45 Calibri,Arial,sans-serif;color:#111;margin:24px}h1{font-size:16px;margin:0}h2{font-size:13px;margin:22px 0 6px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:3px 6px}th{background:#f2f2f2;text-align:left}.n{text-align:right;white-space:nowrap}
</style></head><body><h1>${esc(d.companyName)}</h1><div>${esc(d.cin)} · ${esc(d.reportType)} · ${esc(d.cy.start)} to ${esc(d.cy.end)} · amounts in INR</div>${body || '<p>Nothing tagged yet.</p>'}${notes ? `<h2>Notes</h2>${notes}` : ''}</body></html>`
}

/** The lines of a row kind that carry a concept, for the form and the preview. */
export function taggedOf(kind: RowKind, s: { rows: readonly TagRow[]; socie: readonly SocieRow[]; ppe: readonly PpeRow[] }): { id: string; concept: string }[] {
  if (kind === 'socie') return s.socie.map((r) => ({ id: r.id, concept: r.concept }))
  if (kind === 'ppe') return s.ppe.map((r) => ({ id: r.id, concept: r.member }))
  return s.rows.filter((r) => r.statement === kind).map((r) => ({ id: r.id, concept: r.concept }))
}
