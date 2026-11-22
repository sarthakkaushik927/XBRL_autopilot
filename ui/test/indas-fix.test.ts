/**
 * Fix with AI for the Ind AS Problems panel: the request (no identity data), the dry run of each proposed change with
 * the Difference check, and IndasPipelineService.proposeFix over a fake backend.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIX_STOPPED, type FixLine, type FixProblem } from '@shared/indas'
import type { HttpMethod, SidecarResponse } from '@shared/ipc'
import { applyChange, dryRun } from '../electron/main/services/indas-fix-dry-run'
import type { IndasKnowledgeBase } from '../electron/main/services/indas-knowledge-base'
import { IndasPipelineService } from '../electron/main/services/indas-pipeline-service'
import type { SidecarClient, SidecarFileClient } from '../electron/main/services/ports'
import { cardState, effectText, fixRequestOf, FIX_MAX_LINES } from '../src/features/indas/fix'
import type { TagRow } from '../src/features/indas/model'
import { problemsOf } from '../src/features/indas/workspace'

const kb = JSON.parse(readFileSync(join(__dirname, '../../knowledge_base/ind_as_knowledge_base.json'), 'utf8')) as IndasKnowledgeBase

const row = (i: number, label: string, concept: string, cy: number | null, statement: TagRow['statement'] = 'balanceSheet'): TagRow => ({
  id: `${statement}:${i}`,
  statement,
  label,
  breadcrumb: 'Assets > Current assets',
  note: '',
  cy,
  py: null,
  suggestions: [],
  concept,
  periodRole: 'end',
})

// Trade receivables tagged non-current: current assets don't add up (1,90,000 vs 68,000)
const ROWS: TagRow[] = [
  row(1, 'Inventories', 'ind-as:Inventories', 50000),
  row(2, 'Trade receivables', 'ind-as:NoncurrentAssets', 122000),
  row(3, 'Other current assets', 'ind-as:OtherCurrentAssets', 18000),
  row(4, 'Total current assets', 'ind-as:CurrentAssets', 190000),
  row(5, 'Revenue from operations', 'ind-as:RevenueFromOperations', 900000, 'profitLoss'),
]
const lines = (rows: TagRow[]): FixLine[] => fixRequestOf([PROBLEM], rows).filing
const PROBLEM: FixProblem = { id: 'balanceSheet:CY:ind-as:CurrentAssets:Total current assets', message: 'x', concept: 'ind-as:CurrentAssets', elr: '110000', year: 'CY', statement: 'balanceSheet' }

describe('Fix with AI: the request', () => {
  it('Difference problems carry what the AI needs; readiness and company problems do not', () => {
    const problems = problemsOf({
      readiness: [{ message: 'Add at least 2 signatory directors.', fix: 'masters' }],
      checks: { balanceSheet: { differences: [{ year: 'CY', elr: '110000', concept: 'ind-as:CurrentAssets', label: 'Total current assets', reported: '190000', calculated: '68000', difference: '122000', children: [] }], total: '122000', facts: {}, byElr: {} } },
      result: { ok: false, errors: [{ type: 'INVALID_DIN', message: 'DIN' }] },
      lines: { rows: ROWS, socie: [], ppe: [] },
    })
    expect(problems.filter((p) => p.fix).map((p) => p.fix)).toEqual([
      { id: 'balanceSheet:CY:ind-as:CurrentAssets:Total current assets', message: expect.stringContaining('Total current assets'), concept: 'ind-as:CurrentAssets', elr: '110000', year: 'CY', statement: 'balanceSheet' },
    ])
  })

  it('sends every line of the problems’ statements with amounts and tags, nothing else', () => {
    const req = fixRequestOf([PROBLEM], ROWS)
    expect(req.lines.map((l) => l.id)).toEqual(['balanceSheet:1', 'balanceSheet:2', 'balanceSheet:3', 'balanceSheet:4'])
    expect(req.lines[1]).toEqual({ id: 'balanceSheet:2', statement: 'balanceSheet', label: 'Trade receivables', headings: 'Assets > Current assets', cy: 122000, py: null, concept: 'ind-as:NoncurrentAssets', periodRole: 'end' })
    expect(Object.keys(req)).toEqual(['problems', 'lines', 'filing'])
    // the dry run gets every tagged line of the filing too (main only: never sent to the backend)
    expect(req.filing.map((l) => l.id)).toEqual(['balanceSheet:1', 'balanceSheet:2', 'balanceSheet:3', 'balanceSheet:4', 'profitLoss:5'])
    const many = Array.from({ length: FIX_MAX_LINES + 5 }, (_, i) => row(i, `l${i}`, '', 1))
    expect(fixRequestOf([PROBLEM], many).lines).toHaveLength(FIX_MAX_LINES)
  })
})

describe('Fix with AI: dry run with the Difference check', () => {
  it('says what each change alone does to its statement', () => {
    const [good, bad] = dryRun(kb, lines(ROWS), [
      { problemId: PROBLEM.id, rowId: 'balanceSheet:2', concept: 'ind-as:TradeReceivablesCurrent', conceptLabel: 'Trade receivables, current', reason: 'current' },
      { problemId: PROBLEM.id, rowId: 'balanceSheet:1', concept: '', conceptLabel: '', reason: 'twice' },
    ])
    // TradeReceivablesCurrent rolls up into current financial assets, not straight into current assets: still 1 off
    expect(good).toMatchObject({ rowId: 'balanceSheet:2', fromConcept: 'ind-as:NoncurrentAssets', concept: 'ind-as:TradeReceivablesCurrent', effect: { before: 1 } })
    expect(bad).toMatchObject({ rowId: 'balanceSheet:1', concept: '', effect: { before: 1, after: 1, better: false } })
  })

  it('a change that makes the total add up is marked better', () => {
    const [c] = dryRun(kb, lines(ROWS), [{ problemId: PROBLEM.id, rowId: 'balanceSheet:2', concept: 'ind-as:CurrentFinancialAssets', conceptLabel: 'Current financial assets', reason: 'it is a current financial asset' }])
    expect(c.effect).toEqual({ before: 1, after: 0, totalBefore: '122000', totalAfter: '0', better: true, together: true })
  })

  it('untagging a total’s last tagged part does not count as a fix (the total stays checked)', () => {
    const only = [row(1, 'Cash', 'ind-as:CashAndCashEquivalents', 200), row(2, 'Total current financial assets', 'ind-as:CurrentFinancialAssets', 600)]
    const [c] = dryRun(kb, lines(only), [{ problemId: PROBLEM.id, rowId: 'balanceSheet:1', concept: '', conceptLabel: '', reason: 'hide it' }])
    expect(c.effect).toEqual({ before: 1, after: 1, totalBefore: '400', totalAfter: '600', better: false, together: false })
  })

  it('a part moved to its right total does not leave a phantom problem on the old one', () => {
    // Trade receivables tagged non-current (its own total is checked), moved back to current: both totals add up
    const moved = [row(1, 'Trade receivables', 'ind-as:TradeReceivablesNoncurrent', 400), row(2, 'Total non-current financial assets', 'ind-as:NoncurrentFinancialAssets', 900), row(3, 'Total current financial assets', 'ind-as:CurrentFinancialAssets', 400)]
    const [c] = dryRun(kb, lines(moved), [{ problemId: PROBLEM.id, rowId: 'balanceSheet:1', concept: 'ind-as:TradeReceivablesCurrent', conceptLabel: '', reason: '' }])
    expect(c.effect).toMatchObject({ after: 0, better: true })
  })

  it('scores a change on the whole filing: a fixed total traded for a duplicate fact in another statement is not better', () => {
    // the P&L already reports CurrentFinancialAssets with another amount: the retag fixes the total but makes a duplicate
    const clash = [...ROWS, row(6, 'Odd line', 'ind-as:CurrentFinancialAssets', 5, 'profitLoss')]
    const [c] = dryRun(kb, lines(clash), [{ problemId: PROBLEM.id, rowId: 'balanceSheet:2', concept: 'ind-as:CurrentFinancialAssets', conceptLabel: '', reason: '' }])
    expect(c.effect).toMatchObject({ better: false, together: false })
  })

  it('Accept all keeps only the changes that help together (the same fix twice counts once)', () => {
    const fix = { problemId: PROBLEM.id, rowId: 'balanceSheet:2', concept: 'ind-as:CurrentFinancialAssets', conceptLabel: '', reason: '' }
    const [a, b, c] = dryRun(kb, lines(ROWS), [fix, fix, { ...fix, rowId: 'balanceSheet:1', concept: '' }])
    expect([a.effect.better, b.effect.better, c.effect.better]).toEqual([true, true, false])
    expect([a.effect.together, b.effect.together, c.effect.together]).toEqual([true, false, false])
  })

  it('drops changes on lines the request did not have, and applies a period role', () => {
    expect(dryRun(kb, lines(ROWS), [{ problemId: PROBLEM.id, rowId: 'profitLoss:9', concept: 'x', conceptLabel: '', reason: '' }])).toEqual([])
    expect(applyChange(lines(ROWS), { rowId: 'balanceSheet:1', concept: 'ind-as:Inventories', periodRole: 'start' })[0]).toMatchObject({ periodRole: 'start' })
  })
})

describe('Fix with AI: cards', () => {
  const card = { id: '0', problemId: 'p', rowId: 'balanceSheet:2', fromConcept: 'ind-as:NoncurrentAssets', concept: 'c', conceptLabel: 'C', reason: '', effect: { before: 2, after: 1, totalBefore: '5', totalAfter: '1', better: true, together: true }, state: 'open' as const }
  it('a card goes stale when its line was retagged since', () => {
    expect(cardState(card, { concept: 'ind-as:NoncurrentAssets' })).toBe('open')
    expect(cardState(card, { concept: 'other' })).toBe('stale')
    expect(cardState(card, undefined)).toBe('stale')
    expect(cardState({ ...card, state: 'accepted' }, { concept: 'c' })).toBe('accepted')
  })
  it('describes the effect', () => {
    expect(effectText(card.effect, String)).toBe('2 → 1 problem')
    expect(effectText({ ...card.effect, after: 2 }, String)).toBe('2 → 2 problems, difference 5 → 1')
  })
})

describe('IndasPipelineService.proposeFix', () => {
  function backend(answer: unknown) {
    const calls: { path: string; body?: unknown }[] = []
    const sidecar: SidecarClient & SidecarFileClient = {
      whenReady: async () => {},
      request: async <T,>(_m: HttpMethod, path: string, body?: unknown) => {
        calls.push({ path, body })
        const data = path.endsWith('/authority') ? kb : answer
        return { status: 200, data: { success: true, message: 'ok', data } } as SidecarResponse<T>
      },
      upload: async () => ({ status: 404, data: null as never }),
      download: async () => ({ status: 404, bytes: new Uint8Array() }),
    }
    return { sidecar, calls }
  }
  const writer = { write: async () => '' }

  it('refuses without the user’s AI consent, before any call', async () => {
    const { sidecar, calls } = backend({})
    await expect(new IndasPipelineService(sidecar, writer, () => false).proposeFix(fixRequestOf([PROBLEM], ROWS))).rejects.toThrow(/allow AI in Settings/)
    expect(calls).toEqual([])
  })

  it('Stop: an aborted request ends with FIX_STOPPED and the backend’s request got the signal', async () => {
    const { sidecar } = backend({ explanation: '', changes: [] })
    const seen: (AbortSignal | undefined)[] = []
    const request = sidecar.request
    sidecar.request = (m, p, b, t, signal) => (seen.push(signal), request(m, p, b, t, signal))
    const stop = new AbortController()
    stop.abort()
    await expect(new IndasPipelineService(sidecar, writer, () => true).proposeFix(fixRequestOf([PROBLEM], ROWS), stop.signal)).rejects.toThrow(FIX_STOPPED)
    expect(seen).toContain(stop.signal)
  })

  it('sends each line with its canonical sheet and returns the dry-run changes', async () => {
    const { sidecar, calls } = backend({ explanation: 'Trade receivables are current.', changes: [{ problemId: PROBLEM.id, rowId: 'balanceSheet:2', concept: 'ind-as:CurrentFinancialAssets', conceptLabel: 'Current financial assets', reason: 'current' }] })
    const out = await new IndasPipelineService(sidecar, writer, () => true).proposeFix(fixRequestOf([PROBLEM], ROWS))
    const sent = calls.find((c) => c.path === '/api/v1/indas/fix')!.body as { lines: { sheet: string }[] }
    expect(sent.lines.every((l) => l.sheet === 'CANONICAL_BS')).toBe(true)
    expect(JSON.stringify(sent)).not.toMatch(/Acme|CIN|DIN/)
    expect(out.explanation).toBe('Trade receivables are current.')
    expect(out.changes[0]).toMatchObject({ rowId: 'balanceSheet:2', effect: { better: true, after: 0 } })
  })
})
