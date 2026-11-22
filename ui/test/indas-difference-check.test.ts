import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDifferences } from '../electron/main/services/indas-difference-check'
import type { IndasKnowledgeBase } from '../electron/main/services/indas-knowledge-base'
import { masterFieldsOf } from '../electron/main/services/indas-master-fields'

// the knowledge base GET /api/v1/indas/authority serves
const kb = JSON.parse(readFileSync(join(__dirname, '../../knowledge_base/ind_as_knowledge_base.json'), 'utf8')) as IndasKnowledgeBase

describe('checkDifferences (live Difference bar, client side)', () => {
  it('sums tagged children exactly, within the 1 INR tolerance, plus the balance-sheet balance', () => {
    const res = checkDifferences(kb, [
      // cash rolls up into current financial assets, which (with inventories) make current assets
      { concept: 'ind-as:CurrentAssets', cy: 100.1, py: 50 },
      { concept: 'ind-as:Inventories', cy: 60.05, py: 50 },
      { concept: 'ind-as:CurrentFinancialAssets', cy: 40.05, py: null },
      { concept: 'ind-as:CashAndCashEquivalents', cy: 40.04, py: null },
      { concept: 'ind-as:Assets', cy: 300, py: 50 },
      { concept: 'ind-as:EquityAndLiabilities', cy: 290, py: 50 },
    ])
    const concepts = res.differences.map((d) => d.concept)
    expect(concepts).not.toContain('ind-as:CurrentAssets') // 60.05 + 40.05 = 100.10 exactly (no float drift)
    expect(concepts).not.toContain('ind-as:CurrentFinancialAssets') // 40.05 vs 40.04: within tolerance
    // Assets 300 vs its only tagged child (current assets 100.10): the untagged 199.90 shows, plus the balance gap 10
    expect(res.differences).toContainEqual(expect.objectContaining({ year: 'CY', concept: 'ind-as:Assets', difference: '199.9', children: ['ind-as:CurrentAssets'] }))
    expect(res.differences).toContainEqual(expect.objectContaining({ year: 'CY', elr: '110000', difference: '10', label: expect.stringMatching(/^Balance sheet/) }))
    expect(res.differences.some((d) => d.year === 'PY' && d.label.startsWith('Balance'))).toBe(false)
    expect(res.total).toBe('209.9')
  })

  it('adds same-concept lines into one fact and skips opening balances and untagged lines', () => {
    const res = checkDifferences(kb, [
      { concept: 'ind-as:CurrentAssets', cy: 100, py: null },
      { concept: 'ind-as:Inventories', cy: 30, py: null },
      { concept: 'ind-as:Inventories', cy: 30, py: null },
      { concept: 'ind-as:CurrentFinancialAssets', cy: 40, py: null },
      { concept: 'ind-as:CurrentFinancialAssets', cy: 999, py: null, periodRole: 'start' },
      { concept: '', cy: 5, py: null },
    ])
    expect(res).toMatchObject({ differences: [], total: '0', byElr: {} })
    // the facts the XBRL Form shows: same-concept lines added, opening balances left out
    expect(res.facts).toEqual({
      'ind-as:CurrentAssets': { cy: '100', py: null },
      'ind-as:Inventories': { cy: '60', py: null },
      'ind-as:CurrentFinancialAssets': { cy: '40', py: null },
    })
  })

  it('sums the differences per ELR and year for the Form footer (exact decimals)', () => {
    const res = checkDifferences(kb, [
      { concept: 'ind-as:CurrentAssets', cy: 100.1, py: 70 },
      { concept: 'ind-as:Inventories', cy: 60.05, py: 50 },
      { concept: 'ind-as:Assets', cy: 300, py: 50 },
      { concept: 'ind-as:EquityAndLiabilities', cy: 290, py: 50 },
    ])
    // CY: current assets 100.10 vs inventories 60.05 (40.05) + assets 300 vs current assets (199.9) + balance 10
    // PY: current assets 70 vs 50 (20) + assets 50 vs 70 (|-20|)
    expect(res.byElr['110000']).toEqual({ cy: '249.95', py: '40', issues: 5 })
  })
})

describe('masterFieldsOf', () => {
  it('takes the mandatory company / auditor items and skips tables, abstracts and unknown concepts', () => {
    const out = masterFieldsOf({
      concepts: {
        'in-ca:NameOfCompany': { name: 'NameOfCompany', type: 'stringItemType', labels: { label: 'Name of company' } },
        'in-ca:DetailsRegardingAuditorsTable': { name: 'DetailsRegardingAuditorsTable', abstract: true },
        'in-ca:WhetherAuditorsReportHasBeenQualified': { name: 'W', type: 'booleanItemType', labels: {} },
      },
      businessRules: {
        mandatoryByELR: {
          '700300': ['in-ca:NameOfCompany', 'in-ca:Unknown'],
          '700400': ['in-ca:DetailsRegardingAuditorsTable', 'in-ca:WhetherAuditorsReportHasBeenQualified'],
        },
      },
    })
    expect(out).toEqual({
      company: [{ qname: 'in-ca:NameOfCompany', label: 'Name of company', type: 'stringItemType' }],
      auditor: [{ qname: 'in-ca:WhetherAuditorsReportHasBeenQualified', label: 'W', type: 'booleanItemType' }],
    })
  })

  it('finds the real Ind AS company fields', () => {
    expect(masterFieldsOf(kb).company.length).toBeGreaterThan(0)
  })
})
