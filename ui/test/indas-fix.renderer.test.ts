/**
 * Renderer-side test: type-checked with tsconfig.web.json (*.renderer.test.ts files).
 * Fix with AI's store (stores/indas-fix.ts) with a fake preload bridge: ask → cards → accept one (the tag changes
 * through the Ind AS store and the Difference check re-runs) → reject → stale card → Accept all → a failed request
 * → Stop → the MCA checks re-run by themselves after accepting (issue #20).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixProblem, FixProposal, FixRequest } from '@shared/indas'
import type { TagRow } from '../src/features/indas/model'

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
let answer: Promise<unknown> = ok({ explanation: '', changes: [] })
const sent: FixRequest[] = []
const fake = {
  fix: vi.fn((req: FixRequest) => (sent.push(req), answer)),
  cancelFix: vi.fn(() => Promise.resolve()),
  generate: vi.fn(() => ok({ ok: false, errors: [{ type: 'X', message: 'still one' }] })),
  check: vi.fn(() => ok({ differences: [], total: '0', facts: {}, byElr: {} })),
  onProgress: vi.fn(() => () => {}),
}
;(globalThis as unknown as { window: unknown }).window = { xap: { indas: fake } }

const { useIndas } = await import('../src/stores/indas')
const { useIndasFix } = await import('../src/stores/indas-fix')
const { useUi } = await import('../src/stores/ui')

const row = (i: number, label: string, concept: string): TagRow => ({ id: `balanceSheet:${i}`, statement: 'balanceSheet', label, breadcrumb: '', note: '', cy: i * 10, py: null, suggestions: [], concept, periodRole: 'end' })
const problem: FixProblem = { id: 'p1', message: 'Total current assets 190 ≠ 68', concept: 'ind-as:CurrentAssets', elr: '110000', year: 'CY', statement: 'balanceSheet' }
const effect = { before: 1, after: 0, totalBefore: '122', totalAfter: '0', better: true, together: true }
const proposal: FixProposal = {
  explanation: 'Trade receivables are tagged non-current.',
  changes: [
    { id: 'a', problemId: 'p1', rowId: 'balanceSheet:1', fromConcept: 'ind-as:NoncurrentAssets', concept: 'ind-as:CurrentFinancialAssets', conceptLabel: 'Current financial assets', reason: 'current', effect },
    { id: 'b', problemId: 'p1', rowId: 'balanceSheet:2', fromConcept: 'ind-as:Inventories', concept: 'ind-as:Inventories', conceptLabel: 'Inventories', periodRole: 'start', reason: 'opening', effect },
    { id: 'c', problemId: 'p1', rowId: 'balanceSheet:3', fromConcept: 'ind-as:OtherCurrentAssets', concept: '', conceptLabel: '', reason: 'twice', effect },
  ],
}

const session = () => useIndasFix.getState().sessions.at(-1)!
const states = () => session().cards.map((c) => c.state)

describe('Fix with AI store', () => {
  beforeEach(() => {
    useIndasFix.setState({ sessions: [] })
    useIndas.setState({ open: true, projectId: 'p-1', rows: [row(1, 'Trade receivables', 'ind-as:NoncurrentAssets'), row(2, 'Inventories', 'ind-as:Inventories'), row(3, 'Other current assets', 'ind-as:OtherCurrentAssets')] })
    useUi.setState({ activity: 'problems', sidebarOpen: false })
    answer = ok(proposal)
    sent.length = 0
  })

  it('asks with the problem and its statement’s lines, opens the AI chat and shows the cards', async () => {
    await useIndasFix.getState().ask([problem])
    expect(sent[0]!.problems).toEqual([problem])
    expect(sent[0]!.lines.map((l) => l.id)).toEqual(['balanceSheet:1', 'balanceSheet:2', 'balanceSheet:3'])
    expect(useUi.getState()).toMatchObject({ activity: 'ai', sidebarOpen: true })
    expect(session()).toMatchObject({ projectId: 'p-1', status: 'ready', explanation: proposal.explanation })
    expect(states()).toEqual(['open', 'open', 'open'])
    expect(useIndas.getState().rows[0]!.concept).toBe('ind-as:NoncurrentAssets') // nothing applied yet
  })

  it('Accept applies one change through the Ind AS store; Reject leaves the line alone', async () => {
    await useIndasFix.getState().ask([problem])
    const id = session().id
    useIndasFix.getState().accept(id, 'a')
    useIndasFix.getState().accept(id, 'b')
    useIndasFix.getState().reject(id, 'c')
    const rows = useIndas.getState().rows
    expect(rows[0]!.concept).toBe('ind-as:CurrentFinancialAssets')
    expect(rows[1]).toMatchObject({ concept: 'ind-as:Inventories', periodRole: 'start' })
    expect(rows[2]!.concept).toBe('ind-as:OtherCurrentAssets')
    expect(states()).toEqual(['accepted', 'accepted', 'rejected'])
    expect(useIndas.getState().dirty).toBe(true)
  })

  it('a line retagged since the request is not overwritten (the card goes stale)', async () => {
    await useIndasFix.getState().ask([problem])
    useIndas.getState().setConcept('balanceSheet:1', 'ind-as:TradeReceivablesCurrent')
    useIndasFix.getState().acceptAll(session().id)
    expect(useIndas.getState().rows[0]!.concept).toBe('ind-as:TradeReceivablesCurrent')
    expect(useIndas.getState().rows[2]!.concept).toBe('') // the untag was applied
    expect(states()).toEqual(['stale', 'accepted', 'accepted'])
  })

  it('Accept all applies only the changes that help together; the others stay open', async () => {
    answer = ok({ ...proposal, changes: proposal.changes.map((c) => (c.id === 'b' ? { ...c, effect: { ...effect, together: false } } : c)) })
    await useIndasFix.getState().ask([problem])
    useIndasFix.getState().acceptAll(session().id)
    expect(states()).toEqual(['accepted', 'open', 'accepted'])
    expect(useIndas.getState().rows[1]!.periodRole).toBe('end')
  })

  it('Stop aborts the request in main and the late answer is not shown', async () => {
    let answerNow!: (v: unknown) => void
    answer = new Promise((r) => (answerNow = r))
    const asking = useIndasFix.getState().ask([problem])
    useIndasFix.getState().stop(session().id)
    expect(fake.cancelFix).toHaveBeenCalled()
    answerNow({ ok: true, value: proposal })
    await asking
    expect(session()).toMatchObject({ status: 'stopped', cards: [] })
  })

  it('a failed request shows its reason in the chat', async () => {
    answer = Promise.resolve({ ok: false, error: { kind: 'internal', message: 'Fix with AI sends line items and amounts to the AI: allow AI in Settings first.' } })
    await useIndasFix.getState().ask([problem])
    expect(session()).toMatchObject({ status: 'failed', error: expect.stringContaining('allow AI in Settings') })
  })
})

describe('after accepting, the MCA checks run again by themselves', () => {
  afterEach(() => vi.useRealTimers())
  it('one re-run after the user stops clicking; Problems gets its answer', async () => {
    vi.useFakeTimers()
    useIndasFix.setState({ sessions: [] })
    useIndas.setState({ open: true, busy: null, projectId: 'p-1', result: { ok: false, errors: [{ type: 'X', message: 'a' }, { type: 'Y', message: 'b' }] }, details: { taxonomy: 'ind-as-2017', companyName: 'Acme', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', cy: { start: '2025-04-01', end: '2026-03-31' }, py: null, level: 'Actual', statementPlaces: 0 }, rows: [row(1, 'Trade receivables', 'ind-as:NoncurrentAssets'), row(2, 'Inventories', 'ind-as:Inventories'), row(3, 'Other current assets', 'ind-as:OtherCurrentAssets')] })
    answer = ok(proposal)
    fake.generate.mockClear()
    await useIndasFix.getState().ask([problem])
    useIndasFix.getState().accept(session().id, 'a')
    useIndasFix.getState().accept(session().id, 'b')
    expect(fake.generate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(fake.generate).toHaveBeenCalledTimes(1)
    expect(useIndas.getState().result).toEqual({ ok: false, errors: [{ type: 'X', message: 'still one' }] })
  })
})
