import { describe, expect, it } from 'vitest'
import type { CheckResult, IndasDetails, SheetTree, TransformResult, TreeNode } from '@shared/indas'
import { ppeFromTransform, rowsFromTransform, socieFromTransform } from '../src/features/indas/model'
import {
  CANONICAL_SOURCE,
  MASTERS_URI,
  TEXTS_URI,
  canonicalWorkbook,
  elrOfConcept,
  elrTitle,
  emptyMandatory,
  emptyMasterCount,
  explorerElrs,
  formLines,
  parseRowId,
  previewHtml,
  problemsOf,
  rowCells,
  rowIdAt,
  taggedOf,
  treeOf,
} from '../src/features/indas/workspace'

const t: TransformResult = {
  fileName: 'Acme FS.xlsx',
  source: 'standard_template',
  summary: {},
  sheets: {
    CANONICAL_PL: [{ Row_Index: 1, Line_Item: 'Revenue', Breadcrumb_Hierarchy: 'Income', Note_No: 18, Current_Year_Amount: 900, Previous_Year_Amount: 800 }],
    CANONICAL_BS: [
      { Row_Index: 1, Line_Item: 'Share capital', Breadcrumb_Hierarchy: 'Equity > Share capital', Note_No: 3, Current_Year_Amount: 417830, Previous_Year_Amount: 390220 },
      { Row_Index: 2, Line_Item: 'Heading', Breadcrumb_Hierarchy: 'Assets', Note_No: null, Current_Year_Amount: null, Previous_Year_Amount: null },
      { Row_Index: 3, Line_Item: 'Inventories', Breadcrumb_Hierarchy: 'Assets > Inventories', Note_No: 9, Current_Year_Amount: 1200.5, Previous_Year_Amount: 1000 },
    ],
    CANONICAL_SOCIE: [{ Row_Index: 1, Equity_Component: 'Retained earnings', Transaction_Description: 'Profit', Note_No: null, Current_Year_Amount: 50, Previous_Year_Amount: 40 }],
    CANONICAL_PPE_SCHEDULE: [{ Asset_Class: 'Buildings', Gross_Opening: 100, Net_Current_Year: 105, Net_Previous_Year: 90 }],
  },
}

const node = (qname: string, over: Partial<TreeNode> = {}): TreeNode => ({ qname, label: qname.split(':')[1]!, depth: 1, abstract: false, type: 'monetaryItemType', periodType: 'instant', balance: null, mandatory: false, ...over })
const bsTree: SheetTree = {
  elr: '110000',
  title: 'Balance sheet [Abstract]',
  nodes: [
    node('ind-as:BalanceSheetAbstract', { depth: 0, abstract: true, type: 'stringItemType' }),
    node('ind-as:EquityShareCapital', { mandatory: true }),
    node('ind-as:Inventories'),
    node('ind-as:Goodwill', { mandatory: true }),
    node('ind-as:DescriptionOfX', { mandatory: true, type: 'stringItemType' }),
  ],
}
const trees: Record<string, SheetTree[]> = {
  'CANONICAL_BS:concept': [bsTree],
  'CANONICAL_PL:concept': [{ elr: '210000', title: 'Statement of profit and loss [Abstract]', nodes: [node('ind-as:RevenueFromOperations', { periodType: 'duration' })] }],
  'CANONICAL_FINANCIAL_NOTES:concept': [{ elr: '400300', title: 'Disclosure of notes on borrowings explanatory [Text Block]', nodes: [] }, { elr: '110000', title: 'dup', nodes: [] }],
  'CANONICAL_SOCIE:concept': [{ elr: '400200', title: 'Disclosure of notes on changes in equity [Text Block]', nodes: [] }],
}
const details: IndasDetails = {
  taxonomy: 'ind-as-2017',
  companyName: 'Acme <Pvt> Ltd',
  cin: 'U72200KA2010PTC123456',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Actual',
  statementPlaces: 0,
}

describe('canonical workbook (the Excel pane)', () => {
  it('shows the canonical sheets in their standard order, a bold header row and the rows as given', () => {
    const wb = canonicalWorkbook(t)
    expect(wb.source).toBe(CANONICAL_SOURCE)
    expect(wb.sheets.map((s) => s.name)).toEqual(['CANONICAL_BS', 'CANONICAL_PL', 'CANONICAL_SOCIE', 'CANONICAL_PPE_SCHEDULE'])
    const bs = wb.sheets[0]!
    expect(bs.cells.filter((c) => c.r === 0).map((c) => [c.v, c.bold])).toEqual(
      ['Row_Index', 'Line_Item', 'Breadcrumb_Hierarchy', 'Note_No', 'Current_Year_Amount', 'Previous_Year_Amount'].map((h) => [h, true]),
    )
    expect(bs.cells.find((c) => c.r === 3 && c.c === 4)?.v).toBe(1200.5)
    expect(bs.cells.some((c) => c.r === 2 && c.c === 4)).toBe(false) // blank cells are left out
    expect(bs.rowCount).toBe(4)
  })
})

describe('cell ↔ line links', () => {
  const ids = [...rowsFromTransform(t), ...socieFromTransform(t), ...ppeFromTransform(t)].map((r) => r.id)

  it('canonical row i of a sheet is grid row i + 1', () => {
    expect(rowCells(t, 'balanceSheet:2')).toEqual({
      sheet: 'CANONICAL_BS',
      label: { workbook: CANONICAL_SOURCE, sheet: 'CANONICAL_BS', ref: 'B4' },
      cy: { workbook: CANONICAL_SOURCE, sheet: 'CANONICAL_BS', ref: 'E4' },
      py: { workbook: CANONICAL_SOURCE, sheet: 'CANONICAL_BS', ref: 'F4' },
    })
    expect(rowCells(t, 'socie:0')?.label?.ref).toBe('C2')
    expect(rowCells(t, 'ppe:0')).toMatchObject({ label: { ref: 'A2' }, cy: { ref: 'C2' }, py: { ref: 'D2' } })
    expect(rowCells(t, 'zero:balanceSheet:ind-as:Goodwill')).toBeNull()
  })

  it('any cell of a line row selects that line; the header and lines without amounts select nothing', () => {
    const at = (sheet: string, ref: string) => rowIdAt({ workbook: CANONICAL_SOURCE, sheet, ref }, ids)
    expect(at('CANONICAL_BS', 'A2')).toBe('balanceSheet:0')
    expect(at('CANONICAL_BS', 'F4')).toBe('balanceSheet:2')
    expect(at('CANONICAL_BS', 'B3')).toBeNull()
    expect(at('CANONICAL_BS', 'B1')).toBeNull()
    expect(at('CANONICAL_PL', 'E2')).toBe('profitLoss:0')
    expect(at('CANONICAL_SOCIE', 'B2')).toBe('socie:0')
    expect(rowIdAt({ workbook: 'other.xlsx', sheet: 'CANONICAL_BS', ref: 'A2' }, ids)).toBeNull()
  })

  it('parses row ids', () => {
    expect(parseRowId('noteLines:12')).toEqual({ kind: 'noteLines', index: 12 })
    expect(parseRowId('text:abc')).toBeNull()
  })
})

describe('Filing Explorer', () => {
  it('lists each scope’s ELRs once, grouped by the sheet that tags them, plus text blocks and masters', () => {
    const elrs = explorerElrs(trees)
    expect(elrs.map((e) => [e.group, e.code, e.title])).toEqual([
      ['Statements', '110000', 'Balance sheet'],
      ['Statements', '210000', 'Statement of profit and loss'],
      ['Statements', '400200', 'Disclosure of notes on changes in equity'],
      ['Notes', '400300', 'Disclosure of notes on borrowings explanatory'],
      ['Notes', '[E]', 'Notes text blocks'],
      ['Disclosures', '', 'Company, auditor & signatories'],
    ])
    expect(elrs.find((e) => e.uri === TEXTS_URI)?.kind).toBe('texts')
    expect(elrs.find((e) => e.uri === MASTERS_URI)?.kind).toBe('masters')
    expect(treeOf(trees, elrs[0])).toBe(bsTree)
  })

  it('cleans ELR titles', () => {
    expect(elrTitle('Disclosure of goodwill [Text Block]')).toBe('Disclosure of goodwill')
  })

  it('finds the ELR that shows a tagged concept, else the statement’s first', () => {
    const elrs = explorerElrs(trees)
    expect(elrOfConcept(elrs, trees, 'balanceSheet', 'ind-as:Inventories')?.code).toBe('110000')
    expect(elrOfConcept(elrs, trees, 'noteLines', 'ind-as:Nowhere')?.code).toBe('400300')
  })
})

describe('XBRL Form', () => {
  const rows = rowsFromTransform(t).map((r) => (r.id === 'balanceSheet:0' ? { ...r, concept: 'ind-as:EquityShareCapital' } : r))
  const facts = { 'ind-as:EquityShareCapital': { cy: '417830', py: '390220' } }

  it('puts the facts and their lines on the tree; mandatory empty lines are red, tagged ones green', () => {
    const lines = formLines(bsTree, facts, taggedOf('balanceSheet', { rows, socie: [], ppe: [] }))
    expect(lines.map((l) => [l.node.qname.split(':')[1], l.tone, l.rows, l.value?.cy ?? null])).toEqual([
      ['BalanceSheetAbstract', null, [], null],
      ['EquityShareCapital', 'ok', ['balanceSheet:0'], '417830'],
      ['Inventories', null, [], null],
      ['Goodwill', 'bad', [], null],
      ['DescriptionOfX', 'bad', [], null],
    ])
    // only amounts are zero-filled
    expect(emptyMandatory(lines).map((n) => n.qname)).toEqual(['ind-as:Goodwill'])
  })

  it('the tables tag members: PPE lines show by member', () => {
    const ppe = ppeFromTransform(t).map((r) => ({ ...r, member: 'ind-as:BuildingsMember' }))
    expect(taggedOf('ppe', { rows, socie: [], ppe })).toEqual([{ id: 'ppe:0', concept: 'ind-as:BuildingsMember' }])
  })
})

describe('Problems', () => {
  it('lists readiness, totals that don’t add up (with where to go) and MCA’s answer', () => {
    const check: CheckResult = {
      differences: [{ year: 'CY', elr: '110000', concept: 'ind-as:Assets', label: 'Assets', reported: '300', calculated: '100.1', difference: '199.9', children: [] }],
      total: '199.9',
      facts: {},
      byElr: {},
    }
    const out = problemsOf({
      readiness: [{ message: 'Add at least 2 signatory directors.', fix: 'masters' }],
      checks: { balanceSheet: check },
      result: { ok: false, errors: [{ type: 'MANDATORY', message: 'PAN missing' }] },
      lines: { rows: [], socie: [], ppe: [] },
    })
    expect(out).toEqual([
      { severity: 'warning', source: 'readiness', message: 'Add at least 2 signatory directors.', target: { kind: 'masters' } },
      { severity: 'error', source: 'difference', message: 'Balance Sheet · CY: Assets 300 ≠ 100.1 (difference 199.9)', target: { kind: 'concept', concept: 'ind-as:Assets', elr: '110000' } },
      { severity: 'error', source: 'mca', message: 'MANDATORY: PAN missing', target: null },
    ])
  })

  it('double-click goes to the line behind a problem: the total’s cell for its year, the PPE class, the details dialog', () => {
    const check: CheckResult = {
      differences: [{ year: 'PY', elr: '110000', concept: 'ind-as:Assets', label: 'Assets', reported: '3', calculated: '1', difference: '2', children: [] }],
      total: '2',
      facts: {},
      byElr: {},
    }
    const lines = {
      rows: [
        { id: 'profitLoss:1', concept: 'ind-as:Assets', statement: 'profitLoss' as const },
        { id: 'balanceSheet:7', concept: 'ind-as:Assets', statement: 'balanceSheet' as const },
        { id: 'balanceSheet:2', concept: 'ind-as:Inventories', statement: 'balanceSheet' as const },
      ],
      socie: [],
      ppe: [{ id: 'ppe:3', member: 'ind-as:ComputerEquipmentsMember' }],
    }
    const out = problemsOf({
      readiness: [],
      checks: { balanceSheet: check },
      result: {
        ok: false,
        errors: [
          { type: 'NEGATIVE_VALUE_NOT_PERMITTED', message: 'negative', concept: 'ind-as:Inventories' },
          { type: 'PPE_NET_BLOCK_MISMATCH', message: 'net block', member: 'ind-as:ComputerEquipmentsMember' },
          { type: 'INVALID_DIN', message: 'DIN' },
          { type: 'MANDATORY_STATEMENT_ROOT_MISSING', message: 'root', concept: 'ind-as:EquityAndLiabilities' },
        ],
      },
      lines,
    })
    expect(out.map((p) => p.target)).toEqual([
      { kind: 'line', rowId: 'balanceSheet:7', which: 'py' },
      { kind: 'line', rowId: 'balanceSheet:2', which: 'cy' },
      { kind: 'line', rowId: 'ppe:3', which: 'label' },
      { kind: 'masters' },
      { kind: 'concept', concept: 'ind-as:EquityAndLiabilities', elr: null },
    ])
  })

  it('counts the empty mandatory company / auditor fields', () => {
    const f = { company: [{ qname: 'a:X', label: 'X', type: 's' }, { qname: 'a:Y', label: 'Y', type: 's' }], auditor: [{ qname: 'a:Z', label: 'Z', type: 's' }] }
    expect(emptyMasterCount(f, { 'a:X': 'x', 'a:Y': ' ' }, {})).toBe(2)
    expect(emptyMasterCount(null, {}, {})).toBe(0)
  })
})

describe('Preview', () => {
  it('renders only statements with values, escapes text and shows notes', () => {
    const rows = rowsFromTransform(t).map((r) => (r.id === 'balanceSheet:0' ? { ...r, concept: 'ind-as:EquityShareCapital' } : r))
    const lines = formLines(bsTree, { 'ind-as:EquityShareCapital': { cy: '417830', py: null } }, taggedOf('balanceSheet', { rows, socie: [], ppe: [] }))
    const html = previewHtml(details, [{ title: 'Balance sheet', code: '110000', lines }, { title: 'Empty', code: '210000', lines: [] }], [
      { id: 'text:1', heading: 'Policies <b>', content: 'Line 1\nLine 2', suggestions: [], concept: 'ind-as:X' },
    ])
    expect(html).toContain('Acme &lt;Pvt&gt; Ltd')
    expect(html).toContain('[110000] Balance sheet')
    expect(html).not.toContain('[210000]')
    expect(html).toContain('4,17,830')
    expect(html).toContain('Policies &lt;b&gt;')
    expect(html).toContain('Line 1<br>Line 2')
    expect(html).not.toMatch(/<script/i)
  })
})
