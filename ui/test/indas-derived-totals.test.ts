import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StatementLine } from '@shared/indas'
import { deriveFiling, deriveTotals } from '../electron/main/services/indas-derived-totals'
import { checkDifferences } from '../electron/main/services/indas-difference-check'
import type { IndasKnowledgeBase } from '../electron/main/services/indas-knowledge-base'

// the real knowledge base GET /api/v1/indas/authority serves (issue #20, point 5: verify against MCA's calculation)
const kb = JSON.parse(readFileSync(join(__dirname, '../../knowledge_base/ind_as_knowledge_base.json'), 'utf8')) as IndasKnowledgeBase

const BS = ['110000']
const PL = ['210000', '210000a']
const CF = ['310000', '320000']
const q = (name: string) => `ind-as:${name}`
const line = (name: string, cy: number | null, py: number | null = null, periodRole?: 'start'): StatementLine => ({ concept: q(name), cy, py, ...(periodRole ? { periodRole } : {}) })
const byConcept = (rows: ReturnType<typeof deriveTotals>) => Object.fromEntries(rows.map((d) => [d.concept.slice(7), d]))

describe('deriveTotals (calculated taxonomy elements, from the MCA calculation linkbase)', () => {
  it('sums every level bottom-up with the taxonomy weights (expenses and tax are −1), CY and PY apart, exact decimals', () => {
    const d = byConcept(
      deriveTotals(
        kb,
        [
          line('RevenueFromOperations', 1000.1, 900),
          line('OtherIncome', 50.2, null),
          line('CostOfMaterialsConsumed', 300, 250),
          line('EmployeeBenefitExpense', 200, 150),
          line('CurrentTax', 100, 90),
          line('DeferredTax', -20, 10),
        ],
        PL,
      ),
    )
    expect(d.Income).toMatchObject({ cy: '1050.3', py: '900', parts: [q('RevenueFromOperations'), q('OtherIncome')], elr: '210000' })
    expect(d.Expenses).toMatchObject({ cy: '500', py: '400' })
    expect(d.ProfitBeforeExceptionalItemsAndTax).toMatchObject({ cy: '550.3', py: '500' }) // income − expenses
    expect(d.TaxExpense).toMatchObject({ cy: '80', py: '100' })
    expect(d.ProfitLossForPeriodFromContinuingOperations).toMatchObject({ cy: '470.3', py: '400' }) // − tax
    expect(d.ProfitLossForPeriod).toMatchObject({ cy: '470.3', py: '400', parts: [q('ProfitLossForPeriodFromContinuingOperations')] })
    // the second P&L ELR (OCI net of tax): comprehensive income = profit + OCI, here profit only
    expect(d.ComprehensiveIncome).toMatchObject({ cy: '470.3', elr: '210000a' })
  })

  it('never derives a concept a line reports: the reported total is used for the next level and compared', () => {
    const rows = [line('RevenueFromOperations', 1000), line('OtherIncome', 50), line('Income', 1000), line('OtherExpenses', 400)]
    const d = byConcept(deriveTotals(kb, rows, PL))
    expect(d.Income).toBeUndefined()
    expect(d.ProfitBeforeExceptionalItemsAndTax).toMatchObject({ cy: '600' }) // the reported 1000, not 1050
    const check = checkDifferences(kb, rows, new Set(), deriveTotals(kb, rows, PL))
    expect(check.differences.map((x) => [x.concept, x.difference])).toEqual([[q('Income'), '-50']])
  })

  it('only monetary totals: EPS (per share) and share counts are never summed', () => {
    const d = byConcept(deriveTotals(kb, [line('BasicEarningsLossPerShareFromContinuingOperations', 4.3), line('BasicEarningsLossPerShareFromDiscontinuedOperations', 0.2)], PL))
    expect(d.BasicEarningsLossPerShare).toBeUndefined()
  })

  it('uses only the statement’s ELRs: a total’s parts differ between ELRs (OCI net of tax vs before tax)', () => {
    const beforeTax = [line('OtherComprehensiveIncomeThatWillNotBeReclassifiedToProfitOrLossBeforeTax', 100), line('IncomeTaxRelatingToComponentsOfOtherComprehensiveIncomeThatWillNotBeReclassifiedToProfitOrLoss', 30)]
    // the P&L's own ELRs (210000, 210000a) define OCI from its net-of-tax parts only: nothing to sum
    expect(byConcept(deriveTotals(kb, beforeTax, PL)).OtherComprehensiveIncome).toBeUndefined()
    // 210000b (before tax): OCI = before-tax OCI − tax on it
    expect(byConcept(deriveTotals(kb, beforeTax, ['210000b'])).OtherComprehensiveIncome).toMatchObject({ cy: '70', elr: '210000b' })
    // no ELRs (trees not loaded yet): nothing is derived
    expect(deriveTotals(kb, beforeTax, [])).toEqual([])
  })

  it('cash flow: the method whose parts are tagged wins (direct 310000 vs indirect 320000)', () => {
    const indirect = byConcept(deriveTotals(kb, [line('ProfitBeforeTax', 500), line('AdjustmentsForReconcileProfitLoss', -120)], CF))
    expect(indirect.CashFlowsFromUsedInOperations).toMatchObject({ cy: '380', elr: '320000' })
    const direct = byConcept(deriveTotals(kb, [line('ReceiptsFromSalesOfGoodsAndRenderingOfServices', 900), line('OtherCashReceiptsFromOperatingActivities', 40)], CF))
    expect(direct.CashFlowsFromUsedInOperations).toMatchObject({ cy: '940', elr: '310000' })
  })

  it('leaves opening balances out (they are last year’s closing, not parts of this year’s total)', () => {
    const d = byConcept(deriveTotals(kb, [line('EquityShareCapital', 100, 100), line('OtherEquity', 300, 200), line('OtherEquity', 999, null, 'start')], BS))
    expect(d.EquityAttributableToOwnersOfParent).toMatchObject({ cy: '400', py: '300' })
  })

  it('makes the DGPL balance sheet comparable: no "Total equity" line, equity and liabilities is checked against derived equity', () => {
    const rows = [line('EquityShareCapital', 100), line('OtherEquity', 300), line('Liabilities', 650), line('EquityAndLiabilities', 1000), line('Assets', 1000)]
    // before: equity and liabilities had only liabilities as a tagged part, so the missing equity looked like a 350 gap
    expect(checkDifferences(kb, rows).differences.map((x) => [x.concept, x.difference])).toEqual([[q('EquityAndLiabilities'), '350']])
    const derived = deriveTotals(kb, rows, BS)
    expect(byConcept(derived).Equity).toMatchObject({ cy: '400', parts: [q('EquityAttributableToOwnersOfParent')] })
    const check = checkDifferences(kb, rows, new Set(), derived)
    // now the real gap: 1000 vs 400 + 650
    expect(check.differences.map((x) => [x.concept, x.difference])).toEqual([[q('EquityAndLiabilities'), '-50']])
    expect(check.facts[q('Equity')]).toEqual({ cy: '400', py: null })
    expect(check.derived.map((x) => x.concept)).toContain(q('Equity'))
  })

  it('a derived total is not compared itself (it equals its parts), and balance-sheet totals both derived are still balanced', () => {
    const rows = [line('Inventories', 100), line('CashAndCashEquivalents', 50), line('EquityShareCapital', 100), line('BorrowingsCurrent', 40)]
    const check = checkDifferences(kb, rows, new Set(), deriveTotals(kb, rows, BS))
    expect(check.differences).toEqual([
      expect.objectContaining({ concept: q('Assets'), label: expect.stringMatching(/^Balance sheet/), reported: '150', calculated: '140', difference: '10' }),
    ])
  })
})

describe('deriveFiling (what Generate files and the dry run scores)', () => {
  it('files a derived total once, never when a line of another statement reports it', () => {
    const f = deriveFiling(
      kb,
      {
        balanceSheet: [line('EquityShareCapital', 100), line('OtherEquity', 300), line('Inventories', 70)],
        noteLines: [line('Equity', 400), line('Inventories', 70)],
      },
      { balanceSheet: BS, noteLines: BS },
    )
    const filed = (k: 'balanceSheet' | 'noteLines') => f.lines[k].map((l) => l.concept.slice(7))
    // the BS derives equity, but the notes report it: only the reported fact is filed
    expect(f.derived.balanceSheet.map((d) => d.concept)).toContain(q('Equity'))
    expect(filed('balanceSheet')).not.toContain('Equity')
    // current assets: derived by both statements, filed once from the first (the balance sheet)
    expect(filed('balanceSheet')).toContain('CurrentAssets')
    expect(filed('noteLines')).not.toContain('CurrentAssets')
    expect(f.lines.balanceSheet.find((l) => l.concept === q('EquityAttributableToOwnersOfParent'))).toEqual({ concept: q('EquityAttributableToOwnersOfParent'), cy: 400, py: null })
    expect(f.lines.profitLoss).toEqual([])
  })
})
