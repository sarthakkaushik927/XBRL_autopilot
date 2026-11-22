/**
 * Live Difference check for the Ind AS tagging split view (docs/15 §5 "Diff = 0.00 check bar", Webtel's Difference
 * footer). Runs in the app, not on the sidecar (PR #15 review): the bar refreshes on every edit.
 *
 * The same calculation relationships /generateXML's validator uses (knowledge base `calculation`), but run on the
 * tagged lines only and in exact decimals: per parent, the reported total vs the sum of its tagged children, and
 * Assets vs Equity and liabilities. Totals with no tagged children are not checked (nothing to compare).
 */
import { decimal as Dec } from '@xap/engine'
import type { CheckResult, Difference, StatementLine } from '@shared/indas'
import { conceptLabel, type IndasKnowledgeBase, type KbCalculation } from './indas-knowledge-base'

type Dec = ReturnType<typeof Dec.parse>
type Year = 'cy' | 'py'

const TOLERANCE = Dec.parse('1') // MCA's 1 INR rounding tolerance, as in the validator
const ASSETS = 'ind-as:Assets'
const EQUITY_AND_LIABILITIES = 'ind-as:EquityAndLiabilities'

const abs = (d: Dec): Dec => (Dec.sign(d) < 0 ? Dec.neg(d) : d)
const beyondTolerance = (gap: Dec) => Dec.cmp(abs(gap), TOLERANCE) > 0

function amount(v: unknown): Dec | null {
  if (v === null || v === undefined || typeof v === 'boolean' || v === '') return null
  try {
    return Dec.parse(v as string | number)
  } catch {
    return null
  }
}

/**
 * One fact per tagged concept and year: lines tagged with the same concept are added (webXBRL's "Add",
 * statement_lines.merge_lines on the sidecar). Opening balances (periodRole "start") are not totals' children.
 */
function facts(rows: readonly StatementLine[], year: Year): Map<string, Dec> {
  const out = new Map<string, Dec>()
  for (const r of rows) {
    if (!r.concept || r.periodRole === 'start') continue
    const v = amount(r[year])
    if (v === null) continue
    const prev = out.get(r.concept)
    out.set(r.concept, prev ? Dec.add(prev, v) : v)
  }
  return out
}

function byParent(eqs: readonly KbCalculation[]): Map<string, KbCalculation[]> {
  const out = new Map<string, KbCalculation[]>()
  for (const eq of eqs) out.set(eq.from, [...(out.get(eq.from) ?? []), eq])
  return out
}

/** Tagged lines → the totals that don't tie (amounts as decimal strings) and Σ |difference|. */
export function checkDifferences(kb: IndasKnowledgeBase, rows: readonly StatementLine[]): CheckResult {
  const differences: Difference[] = []
  const gaps: Dec[] = []
  const push = (d: Omit<Difference, 'reported' | 'calculated' | 'difference'>, reported: Dec, calculated: Dec) => {
    const gap = Dec.sub(reported, calculated)
    gaps.push(gap)
    differences.push({ ...d, reported: Dec.toString(reported), calculated: Dec.toString(calculated), difference: Dec.toString(gap) })
  }

  for (const year of ['cy', 'py'] as const) {
    const label: Difference['year'] = year === 'cy' ? 'CY' : 'PY'
    const f = facts(rows, year)
    const seen = new Set<string>()
    for (const [elr, eqs] of Object.entries(kb.calculation ?? {})) {
      for (const [parent, children] of byParent(eqs)) {
        const reported = f.get(parent)
        if (reported === undefined || seen.has(parent)) continue
        const present = children.filter((ch) => f.has(ch.to))
        if (present.length === 0) continue
        seen.add(parent)
        const total = Dec.sum(present.map((ch) => Dec.mul(f.get(ch.to)!, Dec.parse(ch.weight))))
        if (!beyondTolerance(Dec.sub(reported, total))) continue
        push({ year: label, elr, concept: parent, label: conceptLabel(kb, parent), children: present.map((ch) => ch.to) }, reported, total)
      }
    }
    const assets = f.get(ASSETS)
    const eqLiab = f.get(EQUITY_AND_LIABILITIES)
    if (assets !== undefined && eqLiab !== undefined && beyondTolerance(Dec.sub(assets, eqLiab))) {
      push(
        {
          year: label,
          elr: '110000',
          concept: ASSETS,
          label: 'Balance sheet does not balance (Assets − Equity and liabilities)',
          children: [EQUITY_AND_LIABILITIES],
        },
        assets,
        eqLiab,
      )
    }
  }
  return { differences, total: Dec.toString(Dec.sum(gaps.map(abs))) }
}
