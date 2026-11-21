/**
 * Contracts for Vashu's Ind AS pipeline (docs/17): Excel → canonical sheets → tags → masters → XML,
 * driven through the sidecar's /api/v1/indas/* routes. Every canonical sheet is tagged (docs/15 §5).
 */

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

export interface GenerateXmlProblem {
  type: string | null
  message: string
}

export type GenerateXmlResult =
  | { ok: true; path: string; fileName: string; sizeKb: number }
  | { ok: false; errors: GenerateXmlProblem[] }

// ---------------------------------------------------------------- saving the work (docs/17 projects folder)

/** The screen's work as saved in the project file (opaque to main; `version` guards old apps). */
export type IndasDraft = { version: number } & Record<string, unknown>

export interface IndasSaveRequest {
  projectId: string
  /** null = a new file in the projects folder, named after the company and year */
  path: string | null
  draft: IndasDraft
  company: { name: string; cin: string }
  nature: string
  cy: { start: string; end: string }
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
