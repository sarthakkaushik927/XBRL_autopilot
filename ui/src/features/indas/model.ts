/**
 * Pure helpers for the Ind AS pipeline screen (docs/17): canonical rows → taggable rows for every sheet
 * (docs/15 §5), the suggestion keys, master-field prefill and the /generateXML input. No React, no IPC
 * (tested in ui/test/indas-model.test.ts).
 */
import {
  LINE_SHEETS,
  PPE_FIELDS,
  PPE_TABLE,
  SOCIE_TABLE,
  type CanonicalRow,
  type ConceptSuggestion,
  type GenerateXmlInput,
  type IndasDraft,
  type MasterField,
  type NoteText,
  type PeriodRole,
  type Signatory,
  type StatementKey,
  type TransformResult,
} from '@shared/indas'

/** A line of a statement or of the notes ([L]). */
export interface TagRow {
  id: string
  statement: StatementKey
  label: string
  breadcrumb: string
  note: string
  cy: number | null
  py: number | null
  suggestions: ConceptSuggestion[]
  /** the concept the user accepted ('' = not tagged) */
  concept: string
  /** for an instant concept: closing (end) or opening (start) balance */
  periodRole: PeriodRole
}

/** A changes-in-equity movement: concept (the movement) × member (the equity component). */
export interface SocieRow {
  id: string
  component: string
  description: string
  cy: number | null
  py: number | null
  suggestions: ConceptSuggestion[]
  concept: string
  memberSuggestions: ConceptSuggestion[]
  member: string
  periodRole: PeriodRole
}

/** A PPE schedule row: one asset class (a member); the columns map to fixed fields (no AI needed). */
export interface PpeRow {
  id: string
  assetClass: string
  amounts: Record<string, number | null>
  memberSuggestions: ConceptSuggestion[]
  member: string
}

export interface TextBlockRow {
  id: string
  heading: string
  content: string
  suggestions: ConceptSuggestion[]
  concept: string
}

export interface FilingMeta {
  nature: 'Standalone' | 'Consolidated'
  startDate: string
  endDate: string
}

const text = (v: CanonicalRow[string] | undefined) => (v === null || v === undefined ? '' : String(v).trim())

/** A canonical amount as a number; blanks, dashes and non-numbers are null. Values pass through unchanged. */
export function amount(v: CanonicalRow[string] | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/,/g, '').trim()
  if (t === '' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** The lines of every line-tagged sheet (BS, P&L, cash flow, notes) that carry an amount, in sheet order. */
export function rowsFromTransform(t: TransformResult): TagRow[] {
  const out: TagRow[] = []
  for (const st of LINE_SHEETS) {
    ;(t.sheets[st.sheet] ?? []).forEach((r, i) => {
      const cy = amount(r.Current_Year_Amount)
      const py = amount(r.Previous_Year_Amount)
      const label = text(r.Line_Item)
      if (!label || (cy === null && py === null)) return
      out.push({
        id: `${st.key}:${i}`,
        statement: st.key,
        label,
        breadcrumb: text(r.Breadcrumb_Hierarchy),
        note: text(r.Note_No).replace(/\.0$/, ''),
        cy,
        py,
        suggestions: [],
        concept: '',
        periodRole: 'end',
      })
    })
  }
  return out
}

export function socieFromTransform(t: TransformResult): SocieRow[] {
  return (t.sheets[SOCIE_TABLE.sheet] ?? []).flatMap((r, i) => {
    const cy = amount(r.Current_Year_Amount)
    const py = amount(r.Previous_Year_Amount)
    const description = text(r.Transaction_Description)
    if (!description || (cy === null && py === null)) return []
    return [{ id: `socie:${i}`, component: text(r.Equity_Component), description, cy, py, suggestions: [], concept: '', memberSuggestions: [], member: '', periodRole: 'end' as const }]
  })
}

export function ppeFromTransform(t: TransformResult): PpeRow[] {
  return (t.sheets[PPE_TABLE.sheet] ?? []).flatMap((r, i) => {
    const assetClass = text(r.Asset_Class)
    if (!assetClass) return []
    const amounts = Object.fromEntries(Object.keys(PPE_FIELDS).map((c) => [c, amount(r[c])]))
    return [{ id: `ppe:${i}`, assetClass, amounts, memberSuggestions: [], member: '' }]
  })
}

/** What the tagger searches with: the line item; its headings go along as context (docs/15 §3). */
export function suggestionKey(r: Pick<TagRow, 'label'>): string {
  return r.label
}

/** Accept the top suggestion on every row the user hasn't tagged yet. */
export function acceptTopSuggestions<T extends { concept: string; suggestions: ConceptSuggestion[] }>(rows: T[]): T[] {
  return rows.map((r) => (r.concept || !r.suggestions[0] ? r : { ...r, concept: r.suggestions[0].qname }))
}

export function acceptTopMembers<T extends { member: string; memberSuggestions: ConceptSuggestion[] }>(rows: T[]): T[] {
  return rows.map((r) => (r.member || !r.memberSuggestions[0] ? r : { ...r, member: r.memberSuggestions[0].qname }))
}

/** Whether the accepted concept is reported at an instant (then the row can be an opening balance). */
export function isInstant(concept: string, suggestions: ConceptSuggestion[]): boolean {
  return suggestions.find((s) => s.qname === concept)?.periodType === 'instant'
}

/** Values the app already knows (period, nature) for the matching master fields; the user's own values win. */
export function prefillMasters(fields: MasterField[], meta: FilingMeta, current: Record<string, string>): Record<string, string> {
  const known: Record<string, string> = {
    DateOfStartOfReportingPeriod: meta.startDate,
    DateOfEndOfReportingPeriod: meta.endDate,
    NatureOfReportStandaloneConsolidated: meta.nature,
  }
  const out = { ...current }
  for (const f of fields) {
    const local = f.qname.split(':').pop() ?? f.qname
    if (!out[f.qname] && known[local]) out[f.qname] = known[local]
  }
  return out
}

/** How a master field is edited, from its XBRL item type. */
export function fieldKind(type: string): 'date' | 'boolean' | 'text' | 'longtext' {
  if (/date/i.test(type)) return 'date'
  if (/boolean/i.test(type)) return 'boolean'
  if (/textBlock/i.test(type)) return 'longtext'
  return 'text'
}

export interface FilingDraft {
  rows: TagRow[]
  socie: SocieRow[]
  ppe: PpeRow[]
  texts: TextBlockRow[]
  meta: FilingMeta
  company: Record<string, string>
  auditor: Record<string, string>
  signatories: Signatory[]
}

/** Problems that would make /generateXML refuse, found before sending (the sidecar checks again). */
export function readinessProblems(input: Pick<FilingDraft, 'rows' | 'meta' | 'signatories' | 'company'> & { companyFields: MasterField[] }): string[] {
  const p: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.meta.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.meta.endDate)) p.push('Enter the financial year start and end dates.')
  if (!input.rows.some((r) => r.concept)) p.push('Tag at least one statement line.')
  const missing = input.companyFields.filter((f) => !(input.company[f.qname] ?? '').trim())
  if (missing.length) p.push(`Fill the company details: ${missing.map((f) => f.label).join(', ')}.`)
  if (input.signatories.length < 2) p.push('Add at least 2 signatory directors.')
  input.signatories.forEach((s, i) => {
    if (!/^\d{8}$/.test(s.din.trim())) p.push(`Signatory ${i + 1}: DIN must be 8 digits.`)
  })
  return p
}

export function buildGenerateInput(s: FilingDraft & { companyNameField?: string }): GenerateXmlInput {
  const lines = (key: StatementKey) =>
    s.rows.filter((r) => r.statement === key && r.concept).map((r) => ({ concept: r.concept, cy: r.cy, py: r.py, periodRole: r.periodRole }))
  const statements = Object.fromEntries(LINE_SHEETS.map((st) => [st.key, lines(st.key)])) as GenerateXmlInput['statements']
  const socieRows = s.socie
    .filter((r) => r.concept && r.member)
    .map((r) => ({ member: r.member, concept: r.concept, cy: r.cy, py: r.py, ...(r.periodRole === 'start' ? { periodRole: 'start' } : {}) }))
  // his PPE checks do arithmetic on every field: a blank schedule cell is 0. Disposals are a reduction his
  // roll-forward subtracts (opening + additions - disposals = closing), so they go as positive amounts even when
  // the schedule prints them with a minus sign.
  const ppeRows = s.ppe
    .filter((r) => r.member)
    .map((r) => ({
      member: r.member,
      ...Object.fromEntries(Object.entries(PPE_FIELDS).map(([col, field]) => [field, ppeAmount(col, r.amounts[col] ?? null)])),
    }))
  const notes: NoteText[] = s.texts.filter((t) => t.concept && t.content.trim()).map((t) => ({ concept: t.concept, content: t.content }))
  const nameKey = s.companyNameField ?? Object.keys(s.company).find((k) => k.endsWith(':NameOfCompany')) ?? ''
  return {
    meta: s.meta,
    master: { company: s.company, auditor: s.auditor, signatories: s.signatories },
    statements,
    tables: [
      { table: SOCIE_TABLE.table, axis: SOCIE_TABLE.axis, rows: socieRows },
      { table: PPE_TABLE.table, axis: PPE_TABLE.axis, rows: ppeRows },
    ],
    notes,
    companyName: (nameKey && s.company[nameKey]) || 'Filing',
  }
}

/** Amounts with Indian digit grouping (display only); blank for no amount. */
export function formatAmount(v: number | null): string {
  return v === null ? '' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** What a saved Ind AS project holds (indas.json). Bump DRAFT_VERSION when the shape changes. */
export const DRAFT_VERSION = 1
export interface IndasWork extends FilingDraft {
  transform: TransformResult | null
}

export function toDraft(w: IndasWork): IndasDraft {
  const { transform, rows, socie, ppe, texts, meta, company, auditor, signatories } = w
  return { version: DRAFT_VERSION, transform, rows, socie, ppe, texts, meta, company, auditor, signatories }
}

/** The saved work back as state; missing parts (an older draft) become empty. */
export function fromDraft(d: Record<string, unknown>): IndasWork {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === 'object' ? (v as T) : fallback)
  return {
    transform: (d.transform as TransformResult | null) ?? null,
    rows: arr<TagRow>(d.rows),
    socie: arr<SocieRow>(d.socie),
    ppe: arr<PpeRow>(d.ppe),
    texts: arr<TextBlockRow>(d.texts),
    meta: obj<FilingMeta>(d.meta, { nature: 'Standalone', startDate: '', endDate: '' }),
    company: obj<Record<string, string>>(d.company, {}),
    auditor: obj<Record<string, string>>(d.auditor, {}),
    signatories: arr<Signatory>(d.signatories),
  }
}

/** The name a project is saved under: the company field, else the workbook's name. */
export function projectCompanyName(w: Pick<IndasWork, 'company' | 'transform'>): string {
  const typed = Object.entries(w.company).find(([k]) => k.endsWith(':NameOfCompany'))?.[1]?.trim()
  return typed || (w.transform?.fileName ?? '').replace(/\.[^.]+$/, '') || 'Untitled company'
}

/** Notes rows grouped by note number, in sheet order (the Notes tab shows one collapsible group per note). */
export function groupByNote(rows: TagRow[]): { note: string; rows: TagRow[] }[] {
  const out: { note: string; rows: TagRow[] }[] = []
  for (const r of rows) {
    const key = r.note || '—'
    const g = out.find((x) => x.note === key)
    if (g) g.rows.push(r)
    else out.push({ note: key, rows: [r] })
  }
  return out
}

/** The tagged lines of a statement, as the Difference check takes them. */
export function checkRows(rows: TagRow[], statement: StatementKey) {
  return rows.filter((r) => r.statement === statement && r.concept).map((r) => ({ concept: r.concept, cy: r.cy, py: r.py, periodRole: r.periodRole }))
}

/** A PPE schedule amount as /generateXML's roll-forward expects it: blank = 0, disposals positive. */
export function ppeAmount(column: string, v: number | null): number {
  if (v === null) return 0
  return /Disposals$/.test(column) ? Math.abs(v) : v
}
