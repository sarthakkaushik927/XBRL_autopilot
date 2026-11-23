/**
 * Live Difference check for the Ind AS tagging split view (docs/15 §5 "Diff = 0.00 check bar", Webtel's Difference
 * footer). Runs in the app, not on the sidecar (PR #15 review): the bar refreshes on every edit.
 *
 * The same calculation relationships /generateXML's validator uses (knowledge base `calculation`), but run on the
 * tagged lines only and in exact decimals: per parent, the reported total vs the sum of its tagged children, and
 * Assets vs Equity and liabilities. Totals with no tagged children are not checked (nothing to compare).
 */
import { decimal as Dec } from '@xap/engine'
import type { CheckResult, DerivedTotal, Difference, ElrDifference, FactValue, StatementLine } from '@shared/indas'
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
function facts(rows: readonly StatementLine[], year: Year, derived: readonly DerivedTotal[] = []): Map<string, Dec> {
  const out = new Map<string, Dec>()
  for (const r of rows) {
    if (!r.concept || r.periodRole === 'start') continue
    const v = amount(r[year])
    if (v === null) continue
    const prev = out.get(r.concept)
    out.set(r.concept, prev ? Dec.add(prev, v) : v)
  }
  // totals summed from their parts (indas-derived-totals): parts of the next total up, never reported by a line
  for (const d of derived) {
    const v = amount(d[year])
    if (v !== null && !out.has(d.concept)) out.set(d.concept, v)
  }
  return out
}

function byParent(eqs: readonly KbCalculation[]): Map<string, KbCalculation[]> {
  const out = new Map<string, KbCalculation[]>()
  for (const eq of eqs) out.set(eq.from, [...(out.get(eq.from) ?? []), eq])
  return out
}

/**
 * The totals the check compares: reported, with at least one tagged part (either year). A dry run keeps checking
 * them after a change (`keepChecking`), so removing a total's last tagged part can't hide its difference.
 */
export function checkedTotals(kb: IndasKnowledgeBase, rows: readonly StatementLine[], derived: readonly DerivedTotal[] = []): Set<string> {
  const out = new Set<string>()
  const own = new Set(derived.map((d) => d.concept))
  for (const year of ['cy', 'py'] as const) {
    const f = facts(rows, year, derived)
    for (const eqs of Object.values(kb.calculation ?? {})) {
      for (const [parent, children] of byParent(eqs)) if (f.has(parent) && !own.has(parent) && children.some((ch) => f.has(ch.to))) out.add(parent)
    }
  }
  return out
}

/**
 * Tagged lines → the facts they make, the totals that don't tie (amounts as decimal strings) and Σ |difference|.
 * A total in `keepChecking` is compared even when none of its parts is tagged (their sum is then 0).
 * `derived` (deriveTotals) are facts too, as parts of the totals above them; they are not compared themselves: they
 * equal their parts by construction, and another ELR's parts of them are not this statement's calculation.
 */
export function checkDifferences(
  kb: IndasKnowledgeBase,
  rows: readonly StatementLine[],
  keepChecking: ReadonlySet<string> = new Set(),
  derived: readonly DerivedTotal[] = [],
): CheckResult {
  const own = new Set(derived.map((d) => d.concept))
  const differences: Difference[] = []
  const gaps: Dec[] = []
  const factValues: Record<string, FactValue> = {}
  const push = (d: Omit<Difference, 'reported' | 'calculated' | 'difference'>, reported: Dec, calculated: Dec) => {
    const gap = Dec.sub(reported, calculated)
    gaps.push(gap)
    differences.push({ ...d, reported: Dec.toString(reported), calculated: Dec.toString(calculated), difference: Dec.toString(gap) })
  }

  for (const year of ['cy', 'py'] as const) {
    const label: Difference['year'] = year === 'cy' ? 'CY' : 'PY'
    const f = facts(rows, year, derived)
    for (const [concept, v] of f) (factValues[concept] ??= { cy: null, py: null })[year] = Dec.toString(v)
    const seen = new Set<string>()
    for (const [elr, eqs] of Object.entries(kb.calculation ?? {})) {
      for (const [parent, children] of byParent(eqs)) {
        const reported = f.get(parent)
        if (reported === undefined || seen.has(parent) || own.has(parent)) continue
        const present = children.filter((ch) => f.has(ch.to))
        if (present.length === 0 && !keepChecking.has(parent)) continue
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
  return { differences, total: Dec.toString(Dec.sum(gaps.map(abs))), facts: factValues, byElr: perElr(differences), derived: [...derived] }
}

/** Σ |difference| per ELR and year, and the number of totals that don't add up. */
function perElr(differences: readonly Difference[]): Record<string, ElrDifference> {
  const sums = new Map<string, { cy: Dec; py: Dec; issues: number }>()
  for (const d of differences) {
    const s = sums.get(d.elr) ?? { cy: Dec.parse('0'), py: Dec.parse('0'), issues: 0 }
    const gap = abs(Dec.parse(d.difference))
    if (d.year === 'CY') s.cy = Dec.add(s.cy, gap)
    else s.py = Dec.add(s.py, gap)
    s.issues++
    sums.set(d.elr, s)
  }
  return Object.fromEntries([...sums].map(([elr, s]) => [elr, { cy: Dec.toString(s.cy), py: Dec.toString(s.py), issues: s.issues }]))
}
