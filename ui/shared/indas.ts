/**
 * Contracts for Vashu's Ind AS pipeline (docs/17): Excel → canonical sheets → tags → masters → XML,
 * driven through the sidecar's /api/v1/indas/* routes. Every canonical sheet is tagged (docs/15 §5).
 */

import type { NewFilingInput } from './project'

/** One canonical row as the sidecar returns it (column → value; blank cells are null). */
export type CanonicalRow = Record<string, string | number | boolean | null>

/** The sheet names produced by /indas/transform (and present in the standard template). */
export const CANONICAL_SHEETS = [
  'CANONICAL_BS',
  'CANONICAL_PL',
  'CANONICAL_CF',
  'CANONICAL_SOCIE',
  'CANONICAL_PPE_SCHEDULE',
  'CANONICAL_FINANCIAL_NOTES',
] as const

/** Sheets tagged line by line ([L]); `key` is the /generateXML statements field. */
export const LINE_SHEETS = [
  { key: 'balanceSheet', sheet: 'CANONICAL_BS', title: 'Balance Sheet' },
  { key: 'profitLoss', sheet: 'CANONICAL_PL', title: 'Profit & Loss' },
  { key: 'cashFlow', sheet: 'CANONICAL_CF', title: 'Cash Flow' },
  { key: 'noteLines', sheet: 'CANONICAL_FINANCIAL_NOTES', title: 'Notes' },
] as const
export type StatementKey = (typeof LINE_SHEETS)[number]['key']

/**
 * Table sheets ([T]): rows are members of one axis (docs/15 §4.4, §4.5). The axis qnames match the sidecar's
 * SHEET_AXES (src/services/sheet_scope.py); `table` is what /generateXML keys its checks on.
 */
export const SOCIE_TABLE = { sheet: 'CANONICAL_SOCIE', table: 'ind-as:StatementOfChangesInEquityTable', axis: 'ind-as:ComponentsOfEquityAxis' } as const
export const PPE_TABLE = { sheet: 'CANONICAL_PPE_SCHEDULE', table: 'ind-as:PropertyPlantAndEquipmentTable', axis: 'ind-as:ClassesOfPropertyPlantAndEquipmentAxis' } as const
/** The scope name for the notes' narrative text blocks ([E]). */
export const TEXT_BLOCKS_SCOPE = 'TEXT_BLOCKS'

/** PPE schedule column → /generateXML PPE row field. */
export const PPE_FIELDS = {
  Gross_Opening: 'grossOpening',
  Gross_Additions: 'grossAdditions',
  Gross_Disposals: 'grossDisposals',
  Gross_Closing: 'grossClosing',
  Dep_Opening: 'depOpening',
  Dep_For_Year: 'depForYear',
  Dep_Disposals: 'depDisposals',
  Dep_Closing: 'depClosing',
  Net_Current_Year: 'netCurrentYear',
  Net_Previous_Year: 'netPreviousYear',
} as const

/** "start" = an opening balance (an instant concept reported at the start of the year). */
export type PeriodRole = 'start' | 'end'

export interface TransformResult {
  /** the uploaded workbook's file name */
  fileName: string
  /** 'standard_template' = read as-is (input path 1); 'heuristic' = converted automatically (path 2) */
  source: string
  sheets: Record<string, CanonicalRow[]>
  /** the transformation's own report (sheet sizes, checks) */
  summary: Record<string, unknown>
}

export interface ConceptSuggestion {
  qname: string
  label: string
  score: number
  type: string | null
  periodType: string | null
  balance: string | null
  /** 'ai' when the LLM chose it among the scoped candidates */
  pickedBy: 'ai' | null
}

/** What to suggest for (docs/15 §3: always one sheet's scope). */
export interface RecommendRequest {
  keys: string[]
  /** each key's headings (breadcrumb), shown to the AI */
  contexts?: string[]
  /** a canonical sheet name, or TEXT_BLOCKS_SCOPE */
  scope: string
  /** 'member' = members of the sheet's table axis */
  kind?: 'concept' | 'member'
}

export interface MasterField {
  qname: string
  label: string
  /** XBRL item type, e.g. stringItemType, dateItemType, booleanItemType, CINNumber */
  type: string
}

export interface MasterFields {
  company: MasterField[]
  auditor: MasterField[]
}

export interface Signatory {
  din: string
  name: string
  designation: string
  signingDate?: string
}

/** One tagged line (amounts exactly as the canonical sheet gave them). */
export interface StatementLine {
  concept: string
  cy: number | null
  py: number | null
  periodRole?: PeriodRole
}

export interface TableInput {
  table: string
  axis: string
  rows: Record<string, string | number | null>[]
}

export interface NoteText {
  concept: string
  content: string
}

export interface GenerateXmlInput {
  meta: {
    nature: 'Standalone' | 'Consolidated'
    /** YYYY-MM-DD */
    startDate: string
    endDate: string
  }
  master: {
    company: Record<string, string>
    auditor: Record<string, string>
    signatories: Signatory[]
  }
  statements: Record<StatementKey, StatementLine[]>
  tables: TableInput[]
  notes: NoteText[]
  /** used for the output file name */
  companyName: string
}

/** The error message of a Fix with AI request the user stopped (renderer and main agree on it). */
export const FIX_STOPPED = 'Fix with AI was stopped.'

/** The error message of a recommend call the user cancelled (renderer and main agree on it). */
export const RECOMMEND_CANCELLED = 'Auto-tag was cancelled.'

export interface GenerateXmlProblem {
  type: string | null
  message: string
  /** what the problem is about, when the checks say (a concept, or a PPE class member) */
  concept?: string | null
  member?: string | null
}

export type GenerateXmlResult =
  /** `xml` = the instance as written (the XML tab shows it) */
  | { ok: true; path: string; fileName: string; sizeKb: number; xml: string }
  | { ok: false; errors: GenerateXmlProblem[] }

// ---------------------------------------------------------------- saving the work (docs/17 projects folder)

/** The screen's work as saved in the project file (opaque to main; `version` guards old apps). */
export type IndasDraft = { version: number } & Record<string, unknown>

/**
 * The filing settings of an Ind AS project (New project / Filing settings…): company, CIN, nature, periods,
 * rounding. The same shape as the C&I New filing form, so one dialog and one validation serve both.
 */
export type IndasDetails = NewFilingInput

export interface IndasSaveRequest {
  projectId: string
  /** null = a new file in the projects folder, named after the company and year */
  path: string | null
  draft: IndasDraft
  details: IndasDetails
}

/** A project file picked in File → Open, with the kind its manifest declares. */
export interface ProjectPick {
  path: string
  kind: 'indas' | 'filing'
}

export interface IndasSaved {
  path: string
  savedAt: string
}

export interface IndasOpened {
  path: string
  projectId: string
  draft: IndasDraft
}

// ---------------------------------------------------------------- split view (docs/15 §5)

/** One taxonomy node of a sheet's tree (presentation order, `depth` = indent). */
export interface TreeNode {
  qname: string
  label: string
  depth: number
  /** headings: shown for structure, not taggable */
  abstract: boolean
  type: string | null
  periodType: string | null
  balance: string | null
  /** MCA requires it (red until tagged, as in webXBRL) */
  mandatory: boolean
}

/** One ELR's tree (a statement, a note) or a table axis's member hierarchy. */
export interface SheetTree {
  elr: string
  title: string
  nodes: TreeNode[]
}

/** A calculation total that does not equal the sum of its tagged children (amounts: decimal strings). */
export interface Difference {
  year: 'CY' | 'PY'
  elr: string
  concept: string
  label: string
  reported: string
  calculated: string
  difference: string
  children: string[]
}

/** One concept's reported value per year: the tagged lines added up exactly (decimal strings; null = no line). */
export interface FactValue {
  cy: string | null
  py: string | null
}

export interface CheckResult {
  differences: Difference[]
  /** Σ |difference| as a decimal string; "0" = everything ties */
  total: string
  /** the facts the tagged lines make (closing balances / period amounts), by concept: what the XBRL Form shows */
  facts: Record<string, FactValue>
  /** per ELR: Σ |difference| per year (decimal strings) and how many totals don't add up (the Form's footer) */
  byElr: Record<string, ElrDifference>
}

export interface ElrDifference {
  cy: string
  py: string
  issues: number
}

// ---------------------------------------------------------------- Fix with AI (Problems panel)

/** A total that doesn't add up, as Fix with AI sends it (`id` is stable: statement, year and concept). */
export interface FixProblem {
  id: string
  message: string
  concept: string
  elr: string | null
  year: 'CY' | 'PY'
  statement: StatementKey
}

/** A line of the problems' statements as the AI sees it: no company name, CIN or DINs (amounts may go). */
export interface FixLine {
  id: string
  statement: StatementKey
  label: string
  headings: string
  cy: number | null
  py: number | null
  concept: string
  periodRole: PeriodRole
}

export interface FixRequest {
  problems: FixProblem[]
  /** the problems' statements: what the AI sees */
  lines: FixLine[]
  /** every tagged line of every statement: the app's dry run scores each change on the whole filing (never sent to the AI) */
  filing: FixLine[]
}

/** One proposed tag change: the line gets another concept ('' = no tag) and/or becomes an opening / closing balance. */
export interface FixChange {
  id: string
  problemId: string
  rowId: string
  /** the line's tag when the AI was asked */
  fromConcept: string
  concept: string
  conceptLabel: string
  periodRole?: PeriodRole
  reason: string
  /**
   * The app's own dry run of this change alone on the whole filing (the live Difference check of every statement +
   * Generate's statement rules): how many problems before and after, Σ |difference| before and after (decimal
   * strings), whether that is better, and whether it still helps together with the other helpful changes
   * (`together`: what Accept all applies).
   */
  effect: { before: number; after: number; totalBefore: string; totalAfter: string; better: boolean; together: boolean }
}

export interface FixProposal {
  explanation: string
  changes: FixChange[]
}
