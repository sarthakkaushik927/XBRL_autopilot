import { describe, expect, it } from 'vitest'
import type { ConceptSuggestion, MasterField, TransformResult } from '@shared/indas'
import {
  acceptTopSuggestions,
  amount,
  buildGenerateInput,
  fieldKind,
  prefillMasters,
  readinessProblems,
  isInstant,
  ppeFromTransform,
  rowsFromTransform,
  socieFromTransform,
  suggestionKey,
  type TagRow,
} from '../src/features/indas/model'

const transform: TransformResult = {
  fileName: 'fs.xlsx',
  source: 'heuristic',
  summary: {},
  sheets: {
    CANONICAL_BS: [
      { Row_Index: 1, Line_Item: 'Share capital', Breadcrumb_Hierarchy: 'EQUITY AND LIABILITIES > Equity > Share capital', Note_No: 3.0, Current_Year_Amount: 417830, Previous_Year_Amount: 390220 },
      { Row_Index: 2, Line_Item: 'Non-current assets', Breadcrumb_Hierarchy: 'Assets', Note_No: null, Current_Year_Amount: null, Previous_Year_Amount: null },
      { Row_Index: 3, Line_Item: 'Inventories', Breadcrumb_Hierarchy: '', Note_No: null, Current_Year_Amount: '1,200.50', Previous_Year_Amount: '-' },
    ],
    CANONICAL_PL: [{ Row_Index: 1, Line_Item: 'Revenue from operations', Breadcrumb_Hierarchy: 'Income', Note_No: '18', Current_Year_Amount: 9000000, Previous_Year_Amount: null }],
  },
}

const field = (qname: string, type = 'stringItemType'): MasterField => ({ qname, label: qname.split(':')[1], type })
const sug = (qname: string, periodType: string | null = null): ConceptSuggestion => ({ qname, label: '', score: 0.9, type: null, periodType, balance: null, pickedBy: null })

describe('amount', () => {
  it('passes numbers through and reads numeric text; blanks and dashes are null', () => {
    expect(amount(417830)).toBe(417830)
    expect(amount('1,200.50')).toBe(1200.5)
    expect(amount('-')).toBeNull()
    expect(amount('')).toBeNull()
    expect(amount('n/a')).toBeNull()
    expect(amount(null)).toBeNull()
  })
})

describe('rowsFromTransform', () => {
  it('keeps the BS and PL lines that carry an amount, in sheet order', () => {
    const rows = rowsFromTransform(transform)
    expect(rows.map((r) => [r.id, r.label, r.note, r.cy, r.py])).toEqual([
      ['balanceSheet:0', 'Share capital', '3', 417830, 390220],
      ['balanceSheet:2', 'Inventories', '', 1200.5, null],
      ['profitLoss:0', 'Revenue from operations', '18', 9000000, null],
    ])
    expect(rows.every((r) => r.concept === '' && r.suggestions.length === 0)).toBe(true)
  })
})

describe('suggestionKey', () => {
  it('searches with the line item (the headings go along as context)', () => {
    expect(suggestionKey({ label: 'Share capital' })).toBe('Share capital')
  })
})

describe('acceptTopSuggestions', () => {
  it('fills only untagged rows that have a suggestion', () => {
    const base = rowsFromTransform(transform)
    const rows: TagRow[] = [
      { ...base[0], suggestions: [sug('ind-as:EquityShareCapital')] },
      { ...base[1], concept: 'ind-as:Inventories', suggestions: [sug('ind-as:Other')] },
      base[2],
    ]
    expect(acceptTopSuggestions(rows).map((r) => r.concept)).toEqual(['ind-as:EquityShareCapital', 'ind-as:Inventories', ''])
  })
})

describe('prefillMasters', () => {
  const meta = { nature: 'Consolidated' as const, startDate: '2025-04-01', endDate: '2026-03-31' }
  it('fills period and nature fields the app already knows, keeping what the user typed', () => {
    const fields = [field('in-ca:DateOfStartOfReportingPeriod', 'dateItemType'), field('in-ca:DateOfEndOfReportingPeriod', 'dateItemType'), field('in-ca:NatureOfReportStandaloneConsolidated'), field('in-ca:NameOfCompany')]
    expect(prefillMasters(fields, meta, { 'in-ca:DateOfEndOfReportingPeriod': '2026-03-30' })).toEqual({
      'in-ca:DateOfStartOfReportingPeriod': '2025-04-01',
      'in-ca:DateOfEndOfReportingPeriod': '2026-03-30',
      'in-ca:NatureOfReportStandaloneConsolidated': 'Consolidated',
    })
  })
})

describe('fieldKind', () => {
  it('maps XBRL item types to editors', () => {
    expect(fieldKind('dateItemType')).toBe('date')
    expect(fieldKind('booleanItemType')).toBe('boolean')
    expect(fieldKind('textBlockItemType')).toBe('longtext')
    expect(fieldKind('CINNumber')).toBe('text')
  })
})

describe('readinessProblems and buildGenerateInput', () => {
  const meta = { nature: 'Standalone' as const, startDate: '2025-04-01', endDate: '2026-03-31' }
  const rows = rowsFromTransform(transform).map((r, i) => (i === 0 ? { ...r, concept: 'ind-as:EquityShareCapital' } : r))
  const companyFields = [field('in-ca:NameOfCompany'), field('in-ca:CorporateIdentityNumber')]

  it('lists what would make generation fail', () => {
    const p = readinessProblems({ rows: rowsFromTransform(transform), meta: { ...meta, endDate: '' }, signatories: [{ din: '123', name: '', designation: 'Director' }], companyFields, company: { 'in-ca:NameOfCompany': 'Acme' } })
    expect(p).toEqual([
      'Enter the financial year start and end dates.',
      'Tag at least one statement line.',
      'Fill the company details: CorporateIdentityNumber.',
      'Add at least 2 signatory directors.',
      'Signatory 1: DIN must be 8 digits.',
    ])
  })

  it('is ready when everything is filled', () => {
    const signatories = [
      { din: '01234567', name: 'A', designation: 'Director' },
      { din: '76543210', name: 'B', designation: 'Director' },
    ]
    expect(readinessProblems({ rows, meta, signatories, companyFields, company: { 'in-ca:NameOfCompany': 'Acme', 'in-ca:CorporateIdentityNumber': 'U1' } })).toEqual([])
  })

  it('sends only accepted tags, per statement, and names the file after the company', () => {
    const input = buildGenerateInput({ rows, socie: [], ppe: [], texts: [], meta, company: { 'in-ca:NameOfCompany': 'Acme Pvt Ltd' }, auditor: {}, signatories: [] })
    expect(input.statements).toEqual({ balanceSheet: [{ concept: 'ind-as:EquityShareCapital', cy: 417830, py: 390220, periodRole: 'end' }], profitLoss: [], cashFlow: [], noteLines: [] })
    expect(input.companyName).toBe('Acme Pvt Ltd')
  })
})

describe('every canonical sheet (docs/15 §5)', () => {
  const t: TransformResult = {
    fileName: 'fs.xlsx',
    source: 'standard_template',
    summary: {},
    sheets: {
      CANONICAL_CF: [{ Line_Item: 'Cash and cash equivalents at beginning of the year', Breadcrumb_Hierarchy: 'Cash flow', Current_Year_Amount: 10, Previous_Year_Amount: 8 }],
      CANONICAL_FINANCIAL_NOTES: [{ Note_No: 9, Line_Item: 'Raw materials', Breadcrumb_Hierarchy: 'Inventories', Current_Year_Amount: 7, Previous_Year_Amount: null }],
      CANONICAL_SOCIE: [
        { Equity_Component: 'Retained Earnings', Transaction_Description: 'Profit for the year', Current_Year_Amount: 50, Previous_Year_Amount: 40 },
        { Equity_Component: 'Retained Earnings', Transaction_Description: 'Heading only', Current_Year_Amount: null, Previous_Year_Amount: null },
      ],
      CANONICAL_PPE_SCHEDULE: [
        { Asset_Class: 'Buildings', Gross_Opening: 100, Gross_Additions: 20, Gross_Disposals: null, Gross_Closing: 120, Dep_Opening: 10, Dep_For_Year: 5, Dep_Disposals: null, Dep_Closing: 15, Net_Current_Year: 105, Net_Previous_Year: 90 },
        { Asset_Class: '', Gross_Opening: 1 },
      ],
    },
  }

  it('reads cash flow and note lines as taggable lines', () => {
    expect(rowsFromTransform(t).map((r) => [r.statement, r.label, r.note])).toEqual([
      ['cashFlow', 'Cash and cash equivalents at beginning of the year', ''],
      ['noteLines', 'Raw materials', '9'],
    ])
  })

  it('reads changes in equity (rows with amounts) and fixed-asset classes', () => {
    expect(socieFromTransform(t).map((r) => [r.component, r.description, r.cy])).toEqual([['Retained Earnings', 'Profit for the year', 50]])
    const ppe = ppeFromTransform(t)
    expect(ppe.map((r) => r.assetClass)).toEqual(['Buildings'])
    expect(ppe[0].amounts.Gross_Disposals).toBeNull()
  })

  it('offers opening / closing only for instant concepts', () => {
    expect(isInstant('ind-as:Cash', [sug('ind-as:Cash', 'instant')])).toBe(true)
    expect(isInstant('ind-as:Profit', [sug('ind-as:Profit', 'duration')])).toBe(false)
    expect(isInstant('ind-as:Typed', [])).toBe(false)
  })

  it('builds the equity table, the PPE table (blank = 0) and the text blocks', () => {
    const socie = socieFromTransform(t).map((r) => ({ ...r, member: 'ind-as:RetainedEarningsMember', concept: 'ind-as:ProfitLossForPeriod' }))
    const ppe = ppeFromTransform(t).map((r) => ({ ...r, member: 'ind-as:BuildingsMember' }))
    const texts = [
      { id: 'text:1', heading: 'PPE', content: 'Policy text', suggestions: [], concept: 'ind-as:DisclosureOfPropertyPlantAndEquipmentExplanatory' },
      { id: 'text:2', heading: 'Untagged', content: 'x', suggestions: [], concept: '' },
    ]
    const cf = rowsFromTransform(t).map((r) => ({ ...r, concept: r.statement === 'cashFlow' ? 'ind-as:CashAndCashEquivalentsCashFlowStatement' : '', periodRole: 'start' as const }))
    const input = buildGenerateInput({ rows: cf, socie, ppe, texts, meta: { nature: 'Standalone', startDate: '2025-04-01', endDate: '2026-03-31' }, company: {}, auditor: {}, signatories: [] })
    expect(input.statements.cashFlow).toEqual([{ concept: 'ind-as:CashAndCashEquivalentsCashFlowStatement', cy: 10, py: 8, periodRole: 'start' }])
    expect(input.tables[0]).toEqual({
      table: 'ind-as:StatementOfChangesInEquityTable',
      axis: 'ind-as:ComponentsOfEquityAxis',
      rows: [{ member: 'ind-as:RetainedEarningsMember', concept: 'ind-as:ProfitLossForPeriod', cy: 50, py: 40 }],
    })
    expect(input.tables[1].table).toContain('PropertyPlantAndEquipment') // his PPE checks key on this
    expect(input.tables[1].rows).toEqual([
      { member: 'ind-as:BuildingsMember', grossOpening: 100, grossAdditions: 20, grossDisposals: 0, grossClosing: 120, depOpening: 10, depForYear: 5, depDisposals: 0, depClosing: 15, netCurrentYear: 105, netPreviousYear: 90 },
    ])
    expect(input.notes).toEqual([{ concept: 'ind-as:DisclosureOfPropertyPlantAndEquipmentExplanatory', content: 'Policy text' }])
  })
})
