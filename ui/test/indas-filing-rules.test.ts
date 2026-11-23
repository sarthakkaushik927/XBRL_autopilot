/**
 * Generate's statement rules run in the app (issue #20, point 4): the same answers as the backend validator
 * (src/pipeline/xml_generation_pipeline.py IndASValidator) for duplicates, totals across statements, the balance
 * sheet and non-negative concepts, over the real Ind AS knowledge base.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StatementLine } from '@shared/indas'
import { filingRuleErrors } from '../electron/main/services/indas-filing-rules'
import type { IndasKnowledgeBase } from '../electron/main/services/indas-knowledge-base'

const kb = JSON.parse(readFileSync(join(__dirname, '../../knowledge_base/ind_as_knowledge_base.json'), 'utf8')) as IndasKnowledgeBase
const l = (concept: string, cy: number | null, py: number | null = null, periodRole: StatementLine['periodRole'] = 'end'): StatementLine => ({ concept, cy, py, periodRole })
const types = (statements: StatementLine[][]) => filingRuleErrors(kb, statements).map((e) => `${e.type} ${e.concept}`)

describe('filingRuleErrors', () => {
  it('nothing to report on consistent statements', () => {
    expect(types([[l('ind-as:Inventories', 50), l('ind-as:OtherCurrentAssets', 18)], [l('ind-as:RevenueFromOperations', 900)]])).toEqual([])
  })

  it('the same concept in two statements with different amounts is a duplicate; equal amounts are fine', () => {
    expect(types([[l('ind-as:ProfitLoss', 100)], [l('ind-as:ProfitLoss', 90)]])).toEqual(['DUPLICATE_FACT_CONFLICT ind-as:ProfitLoss'])
    expect(types([[l('ind-as:ProfitLoss', 100)], [l('ind-as:ProfitLoss', 100)]])).toEqual([])
  })

  it('lines of one statement with the same concept are added first (merge_lines), not a duplicate', () => {
    expect(types([[l('ind-as:Inventories', 30), l('ind-as:Inventories', 20)], [l('ind-as:Inventories', 50)]])).toEqual([])
  })

  it('an opening balance must equal last year’s closing', () => {
    expect(types([[l('ind-as:CashAndCashEquivalents', 500, 400)], [l('ind-as:CashAndCashEquivalents', 300, null, 'start')]])).toEqual(['DUPLICATE_FACT_CONFLICT ind-as:CashAndCashEquivalents'])
    expect(types([[l('ind-as:CashAndCashEquivalents', 500, 400)], [l('ind-as:CashAndCashEquivalents', 400, null, 'start')]])).toEqual([])
  })

  it('a CY total vs its parts across statements, with MCA’s 1 INR tolerance', () => {
    const parts = [l('ind-as:Inventories', 50), l('ind-as:OtherCurrentAssets', 18)]
    expect(types([[...parts, l('ind-as:CurrentAssets', 190)]])).toContain('CALCULATION_MISMATCH ind-as:CurrentAssets')
    expect(types([[...parts, l('ind-as:CurrentAssets', 69)]])).not.toContain('CALCULATION_MISMATCH ind-as:CurrentAssets')
    // the total in one statement, its parts in another: still compared
    expect(types([parts, [l('ind-as:CurrentAssets', 190)]])).toContain('CALCULATION_MISMATCH ind-as:CurrentAssets')
  })

  it('assets vs equity and liabilities', () => {
    expect(types([[l('ind-as:Assets', 100), l('ind-as:EquityAndLiabilities', 90)]])).toContain('BS_OUT_OF_BALANCE ind-as:Assets')
  })

  it('MCA’s non-negative concepts', () => {
    const concept = kb.businessRules!.nonNegativeConcepts![0]
    expect(types([[l(concept, -5)]])).toContain(`NEGATIVE_VALUE_NOT_PERMITTED ${concept}`)
    expect(types([[l(concept, 5)]])).not.toContain(`NEGATIVE_VALUE_NOT_PERMITTED ${concept}`)
  })
})
