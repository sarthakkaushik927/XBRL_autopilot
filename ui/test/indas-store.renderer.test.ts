/**
 * Renderer-side test: type-checked with tsconfig.web.json (*.renderer.test.ts files).
 * The Ind AS editor store (stores/indas.ts) with a fake preload bridge: New project → open financial statements →
 * cell ↔ fact linkage → tagging → zero-fill → settings → save. No Electron, no sidecar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckResult, IndasDetails, IndasSaveRequest, SheetTree, TransformResult, TreeNode } from '@shared/indas'

const details: IndasDetails = {
  taxonomy: 'ind-as-2017',
  companyName: 'Acme Pvt Ltd',
  cin: 'U72200KA2010PTC123456',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Lakhs',
  statementPlaces: 2,
}
const transform: TransformResult = {
  fileName: 'Acme.xlsx',
  source: 'standard_template',
  summary: {},
  sheets: {
    CANONICAL_BS: [
      { Row_Index: 1, Line_Item: 'Share capital', Breadcrumb_Hierarchy: 'Equity > Share capital', Note_No: 3, Current_Year_Amount: 100, Previous_Year_Amount: 90 },
      { Row_Index: 2, Line_Item: 'Inventories', Breadcrumb_Hierarchy: 'Assets > Inventories', Note_No: 9, Current_Year_Amount: 40, Previous_Year_Amount: 30 },
    ],
  },
}
const node = (qname: string, over: Partial<TreeNode> = {}): TreeNode => ({ qname, label: qname.split(':')[1]!, depth: 1, abstract: false, type: 'monetaryItemType', periodType: 'instant', balance: 'credit', mandatory: false, ...over })
const bsTree: SheetTree = { elr: '110000', title: 'Balance sheet [Abstract]', nodes: [node('ind-as:EquityShareCapital'), node('ind-as:Inventories'), node('ind-as:Goodwill', { mandatory: true })] }

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const saves: IndasSaveRequest[] = []
const checks: unknown[][] = []
const checkElrs: (string[] | undefined)[] = []
const fake = {
  create: vi.fn((d: IndasDetails) => ok({ path: 'P:/Projects/Acme Pvt Ltd_FY 2025-26.axbrl', projectId: 'p-1', draft: { version: 2, details: d } })),
  open: vi.fn(),
  save: vi.fn((req: IndasSaveRequest) => (saves.push(req), ok({ path: req.path ?? 'x.axbrl', savedAt: '2026-11-22T00:00:00Z' }))),
  transform: vi.fn(() => ok(transform)),
  tree: vi.fn((scope: string) => ok(scope === 'CANONICAL_BS' ? [bsTree] : [])),
  masterFields: vi.fn(() => ok({ company: [{ qname: 'in-ca:NameOfCompany', label: 'Name', type: 'stringItemType' }, { qname: 'in-ca:PermanentAccountNumberOfEntity', label: 'PAN', type: 'stringItemType' }], auditor: [] })),
  check: vi.fn((rows: { concept: string; cy: number | null }[], elrs?: string[]): Promise<{ ok: true; value: CheckResult }> => {
    checks.push(rows)
    checkElrs.push(elrs)
    const facts = Object.fromEntries(rows.map((r) => [r.concept, { cy: String(r.cy), py: null }]))
    return ok({ differences: [], total: '0', facts, byElr: {}, derived: [] })
  }),
  recommend: vi.fn(),
  onProgress: vi.fn(() => () => {}),
}
;(globalThis as unknown as { window: unknown }).window = { xap: { indas: fake }, confirm: () => true }

const { useIndas } = await import('../src/stores/indas')
const settle = () => new Promise((r) => setTimeout(r, 400)) // the Difference check is debounced

describe('Ind AS editor store', () => {
  beforeEach(async () => {
    await useIndas.getState().close()
    saves.length = 0
  })

  it('New project opens the editor with the settings filled in, and prefills the masters', async () => {
    expect(await useIndas.getState().create(details)).toEqual([])
    await settle()
    const s = useIndas.getState()
    expect(s).toMatchObject({ open: true, projectId: 'p-1', savedPath: 'P:/Projects/Acme Pvt Ltd_FY 2025-26.axbrl', dirty: false, workbook: null })
    expect(s.details).toEqual(details)
    expect(s.company['in-ca:NameOfCompany']).toBe('Acme Pvt Ltd')
    expect(s.activeElr).toBe('CANONICAL_BS#110000') // the first statement, by group
  })

  it('validation problems from main come back to the dialog', async () => {
    fake.create.mockImplementationOnce(() => Promise.resolve({ ok: false, error: { kind: 'validation', message: 'x', problems: ['Enter the company name.'] } }) as never)
    expect(await useIndas.getState().create({ ...details, companyName: '' })).toEqual(['Enter the company name.'])
    expect(useIndas.getState().open).toBe(false)
  })

  it('links cells and facts both ways, tags from the form, and zero-fills empty mandatory amounts', async () => {
    await useIndas.getState().create(details)
    await useIndas.getState().upload('C:/fs.xlsx')
    const s0 = useIndas.getState()
    expect(s0.workbook?.sheets.map((x) => x.name)).toEqual(['CANONICAL_BS'])
    expect(s0.dirty).toBe(true)

    // a cell of row 2 (the first canonical row) selects that line
    useIndas.getState().selectCell({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'E2' })
    expect(useIndas.getState().selection).toEqual({ id: 'balanceSheet:0', field: 'concept' })

    // double-clicking a concept in the form tags it and moves on to the next untagged line (revealed in Excel)
    useIndas.getState().tagFromTree(bsTree.nodes[0]!)
    let s = useIndas.getState()
    expect(s.rows.find((r) => r.id === 'balanceSheet:0')?.concept).toBe('ind-as:EquityShareCapital')
    expect(s.selection?.id).toBe('balanceSheet:1')
    expect(s.reveal?.cell).toEqual({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'B3' })

    // the tagged cell again: its fact is focused in the form
    useIndas.getState().selectCell({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'B2' })
    expect(useIndas.getState().focus?.concept).toBe('ind-as:EquityShareCapital')

    // a fact's chip shows its cell
    useIndas.getState().revealRow('balanceSheet:0', 'py')
    expect(useIndas.getState().reveal?.cell.ref).toBe('F2')

    await settle()
    expect(useIndas.getState().checks.balanceSheet?.facts['ind-as:EquityShareCapital']).toEqual({ cy: '100', py: null })
    // each statement is checked with its trees' ELRs (the totals it implies are derived from them); none before they load
    checkElrs.length = 0
    await useIndas.getState().loadTree('CANONICAL_BS', 'concept')
    useIndas.getState().runCheck()
    await settle()
    expect(checkElrs).toContainEqual(['110000'])
    expect(checkElrs).toContainEqual([])

    useIndas.getState().fillMandatoryZeros()
    s = useIndas.getState()
    expect(s.rows.filter((r) => r.id.startsWith('zero:')).map((r) => r.concept)).toEqual(['ind-as:Goodwill'])
    // untagging a zero line removes it
    useIndas.getState().setConcept('zero:balanceSheet:ind-as:Goodwill', '')
    expect(useIndas.getState().rows.some((r) => r.id.startsWith('zero:'))).toBe(false)
  })

  it('Filing settings validate, update the masters they own and mark the work unsaved', async () => {
    await useIndas.getState().create(details)
    await settle()
    useIndas.getState().setCompany('in-ca:PermanentAccountNumberOfEntity', 'AAACS1234A')
    expect(useIndas.getState().updateDetails({ ...details, cin: 'BAD' })).toEqual(['Enter a valid 21-character CIN (e.g. U72200KA2010PTC123456).'])
    expect(useIndas.getState().updateDetails({ ...details, companyName: 'Acme India Pvt Ltd' })).toEqual([])
    const s = useIndas.getState()
    expect(s.company).toMatchObject({ 'in-ca:NameOfCompany': 'Acme India Pvt Ltd', 'in-ca:PermanentAccountNumberOfEntity': 'AAACS1234A' })
    expect(s.dirty).toBe(true)
  })

  it('saves to the project file with its settings; closing saves unsaved work first', async () => {
    await useIndas.getState().create(details)
    useIndas.getState().addTextBlock()
    expect(await useIndas.getState().close()).toBe(true)
    expect(saves).toHaveLength(1)
    expect(saves[0]).toMatchObject({ projectId: 'p-1', path: 'P:/Projects/Acme Pvt Ltd_FY 2025-26.axbrl', details, draft: { version: 2, details } })
    expect(useIndas.getState().open).toBe(false)
  })
})
