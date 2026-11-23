/**
 * The statement rules /generateXML's validator applies (src/pipeline/xml_generation_pipeline.py IndASValidator),
 * run in the app over the cached knowledge base (issue #20, point 4): Fix with AI's dry run scores a change on the
 * whole filing, so a change that fixes one total but breaks another statement is not shown as helpful.
 *
 * Mirrors the validator's statement gates, in exact decimals:
 * - DUPLICATE_FACT_CONFLICT: one concept, one date, two amounts more than 1 INR apart (also an opening balance ≠
 *   last year's closing);
 * - CALCULATION_MISMATCH: CY totals vs their children over the facts of every statement together;
 * - BS_OUT_OF_BALANCE: assets vs equity and liabilities (CY);
 * - NEGATIVE_VALUE_NOT_PERMITTED: MCA's "should be ≥ 0" concepts (CY).
 * The company / signatory / PPE gates are not about tags; Generate still runs the backend's own validator.
 * Pure: no IPC, no sidecar.
 */
import { decimal as Dec } from '@xap/engine'
import type { StatementLine } from '@shared/indas'
import { conceptLabel, type IndasKnowledgeBase } from './indas-knowledge-base'

type Dec = ReturnType<typeof Dec.parse>

export interface FilingRuleError {
  type: 'DUPLICATE_FACT_CONFLICT' | 'CALCULATION_MISMATCH' | 'BS_OUT_OF_BALANCE' | 'NEGATIVE_VALUE_NOT_PERMITTED'
  concept: string
  message: string
}

const TOLERANCE = Dec.parse('1') // MCA's 1 INR rounding tolerance, as in the validator
const ASSETS = 'ind-as:Assets'
const EQUITY_AND_LIABILITIES = 'ind-as:EquityAndLiabilities'

const abs = (d: Dec): Dec => (Dec.sign(d) < 0 ? Dec.neg(d) : d)
const off = (gap: Dec) => Dec.cmp(abs(gap), TOLERANCE) > 0

function amount(v: unknown): Dec | null {
  if (v === null || v === undefined || typeof v === 'boolean' || v === '') return null
  try {
    return Dec.parse(v as string | number)
  } catch {
    return null
  }
}

interface Merged {
  concept: string
  start: boolean
  cy: Dec | null
  py: Dec | null
}

/** One statement's lines as Generate sends them: same concept and period role → one fact, amounts added (merge_lines). */
function merge(rows: readonly StatementLine[]): Merged[] {
  const out = new Map<string, Merged>()
  for (const r of rows) {
    if (!r.concept) continue
    const start = r.periodRole === 'start'
    const key = `${r.concept}|${start}`
    const m = out.get(key) ?? { concept: r.concept, start, cy: null, py: null }
    for (const year of ['cy', 'py'] as const) {
      const v = amount(r[year])
      if (v !== null) m[year] = m[year] === null ? v : Dec.add(m[year]!, v)
    }
    out.set(key, m)
  }
  return [...out.values()]
}

const show = (d: Dec) => Dec.toString(d)

/** The errors Generate would report about the tagged statements (empty = none of these rules is broken). */
export function filingRuleErrors(kb: IndasKnowledgeBase, statements: readonly (readonly StatementLine[])[]): FilingRuleError[] {
  const errors: FilingRuleError[] = []
  const merged = statements.map(merge)

  // the same fact twice with different amounts (an opening balance is last year's closing date)
  const seen = new Map<string, Dec>()
  for (const st of merged) {
    for (const m of st) {
      for (const [year, when] of [['cy', m.start ? 'PY_END' : 'CY_END'], ['py', m.start ? 'PY2_END' : 'PY_END']] as const) {
        const v = m[year]
        if (v === null) continue
        const key = `${m.concept}|${when}`
        const prev = seen.get(key)
        // within the 1 INR tolerance it is the same amount (a statement in rupees, its note total in paise)
        if (prev !== undefined && off(Dec.sub(prev, v))) {
          errors.push({ type: 'DUPLICATE_FACT_CONFLICT', concept: m.concept, message: `${conceptLabel(kb, m.concept)} is reported twice for the same date with different amounts (${show(prev)} and ${show(v)})` })
        }
        if (prev === undefined) seen.set(key, v)
      }
    }
  }

  // CY facts of every statement together (closing balances / period amounts; the last statement's wins, as in Generate)
  const cy = new Map<string, Dec>()
  for (const st of merged) for (const m of st) if (!m.start && m.cy !== null) cy.set(m.concept, m.cy)

  for (const eqs of Object.values(kb.calculation ?? {})) {
    const parents = new Map<string, typeof eqs>()
    for (const eq of eqs) parents.set(eq.from, [...(parents.get(eq.from) ?? []), eq])
    for (const [parent, children] of parents) {
      const reported = cy.get(parent)
      if (reported === undefined) continue
      const present = children.filter((ch) => cy.has(ch.to))
      if (present.length === 0) continue
      const sum = Dec.sum(present.map((ch) => Dec.mul(cy.get(ch.to)!, Dec.parse(ch.weight))))
      if (off(Dec.sub(reported, sum))) {
        errors.push({ type: 'CALCULATION_MISMATCH', concept: parent, message: `${conceptLabel(kb, parent)} (${show(reported)}) ≠ sum of its parts (${show(sum)})` })
      }
    }
  }

  const assets = cy.get(ASSETS)
  const eqLiab = cy.get(EQUITY_AND_LIABILITIES)
  if (assets !== undefined && eqLiab !== undefined && off(Dec.sub(assets, eqLiab))) {
    errors.push({ type: 'BS_OUT_OF_BALANCE', concept: ASSETS, message: `Total assets (${show(assets)}) ≠ total equity and liabilities (${show(eqLiab)})` })
  }

  const nonNegative = new Set(kb.businessRules?.nonNegativeConcepts ?? [])
  for (const [concept, v] of cy) {
    if (nonNegative.has(concept) && Dec.sign(v) < 0) {
      errors.push({ type: 'NEGATIVE_VALUE_NOT_PERMITTED', concept, message: `${conceptLabel(kb, concept)} cannot be negative (${show(v)})` })
    }
  }
  return errors
}
