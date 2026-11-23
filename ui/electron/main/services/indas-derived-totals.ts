/**
 * Totals the tagged lines imply (issue #20, point 5): after Auto-tag, a total the sheet has no line for (e.g. "Total
 * equity" in DGPL) stays red in the Form although its parts are tagged. Here it is summed from them, the way the MCA
 * taxonomy's calculation linkbase defines it, never by a "Total" in a name:
 * - only the calculation ELRs of the statement being tagged (a parent's parts differ between ELRs: indirect vs direct
 *   cash flow, OCI before vs net of tax), never the union of all ELRs;
 * - when the statement has several ELRs for one total, the one with the most reported parts (first on a tie);
 * - Σ weight × part (weights are ±1), CY and PY separately, opening balances (periodRole "start") left out;
 * - monetary parents and parts of the same period type only (no EPS, shares, percentages);
 * - never a concept a line reports, bottom-up through every level (a derived total is a part of the next one).
 * A derived total is never stored in the rows, so it always follows its parts. Pure: no IPC, no sidecar.
 */
import { decimal as Dec } from '@xap/engine'
import { LINE_SHEETS, type DerivedTotal, type StatementElrs, type StatementKey, type StatementLine } from '@shared/indas'
import type { IndasKnowledgeBase, KbCalculation } from './indas-knowledge-base'

type Dec = ReturnType<typeof Dec.parse>
type Year = 'cy' | 'py'
type Value = Record<Year, Dec | null>

const YEARS = ['cy', 'py'] as const

function amount(v: unknown): Dec | null {
  if (v === null || v === undefined || typeof v === 'boolean' || v === '') return null
  try {
    return Dec.parse(v as string | number)
  } catch {
    return null
  }
}

/** The closing / period facts the lines report, same-concept lines added (an opening balance is another fact). */
function reportedFacts(rows: readonly StatementLine[]): Map<string, Value> {
  const out = new Map<string, Value>()
  for (const r of rows) {
    if (!r.concept || r.periodRole === 'start') continue
    const f = out.get(r.concept) ?? { cy: null, py: null }
    for (const y of YEARS) {
      const v = amount(r[y])
      if (v !== null) f[y] = f[y] === null ? v : Dec.add(f[y]!, v)
    }
    out.set(r.concept, f)
  }
  return out
}

interface Definition {
  elr: string
  parts: KbCalculation[]
}

/**
 * Per parent, its definitions in the given ELRs (in ELR order). A definition with a part that isn't monetary or has
 * another period type than the parent is left out whole: a partial sum of it would be wrong.
 */
function definitions(kb: IndasKnowledgeBase, elrs: readonly string[]): Map<string, Definition[]> {
  const concept = (q: string) => kb.concepts?.[q]
  const monetary = (q: string) => /monetaryItemType$/.test(concept(q)?.type ?? '')
  const out = new Map<string, Definition[]>()
  for (const elr of new Set(elrs)) {
    const byParent = new Map<string, KbCalculation[]>()
    for (const eq of kb.calculation?.[elr] ?? []) byParent.set(eq.from, [...(byParent.get(eq.from) ?? []), eq])
    for (const [parent, parts] of byParent) {
      if (!monetary(parent)) continue
      const period = concept(parent)?.periodType
      if (!parts.every((p) => monetary(p.to) && concept(p.to)?.periodType === period)) continue
      out.set(parent, [...(out.get(parent) ?? []), { elr, parts }])
    }
  }
  return out
}

const hasValue = (v: Value | null): v is Value => !!v && (v.cy !== null || v.py !== null)

/** The totals the lines imply within `elrs` (a statement's ELR codes), bottom-up; [] when nothing is missing. */
export function deriveTotals(kb: IndasKnowledgeBase, rows: readonly StatementLine[], elrs: readonly string[]): DerivedTotal[] {
  const reported = reportedFacts(rows)
  const tagged = new Set(rows.filter((r) => r.concept && r.periodRole !== 'start').map((r) => r.concept))
  const defs = definitions(kb, elrs)
  const memo = new Map<string, Value | null>()
  const derived: DerivedTotal[] = []
  const resolving = new Set<string>()

  const valueOf = (concept: string): Value | null => {
    if (tagged.has(concept)) return reported.get(concept) ?? null
    if (memo.has(concept)) return memo.get(concept)!
    const candidates = defs.get(concept)
    if (!candidates || resolving.has(concept)) return null
    resolving.add(concept)
    // the ELR with the most parts that have an amount (either year); the first one on a tie
    let best: { elr: string; present: { eq: KbCalculation; v: Value }[] } | null = null
    for (const d of candidates) {
      const present = d.parts.flatMap((eq) => {
        const v = valueOf(eq.to)
        return hasValue(v) ? [{ eq, v }] : []
      })
      if (present.length > (best?.present.length ?? 0)) best = { elr: d.elr, present }
    }
    resolving.delete(concept)
    let value: Value | null = null
    if (best) {
      const sum = (y: Year) => {
        const terms = best!.present.filter((p) => p.v[y] !== null).map((p) => Dec.mul(p.v[y]!, Dec.parse(p.eq.weight)))
        return terms.length ? Dec.sum(terms) : null
      }
      value = { cy: sum('cy'), py: sum('py') }
      derived.push({
        concept,
        cy: value.cy === null ? null : Dec.toString(value.cy),
        py: value.py === null ? null : Dec.toString(value.py),
        parts: best.present.map((p) => p.eq.to),
        elr: best.elr,
      })
    }
    memo.set(concept, value)
    return value
  }

  for (const parent of defs.keys()) valueOf(parent)
  return derived
}

export interface DerivedFiling {
  /** per statement, the totals its lines imply (what its check and Form show) */
  derived: Record<StatementKey, DerivedTotal[]>
  /** per statement, its lines + the derived totals the XML files (what Generate sends and the dry run scores) */
  lines: Record<StatementKey, StatementLine[]>
}

/**
 * Every statement's derived totals, and the ones the XML files: those no line of any statement reports; a total two
 * statements derive is filed once, from the first statement (the face statements before the notes), so it is never a
 * duplicate fact.
 */
export function deriveFiling(kb: IndasKnowledgeBase, statements: Partial<Record<StatementKey, readonly StatementLine[]>>, elrs: StatementElrs = {}): DerivedFiling {
  const per = LINE_SHEETS.map((s) => {
    const lines = statements[s.key] ?? []
    return { key: s.key, lines, derived: deriveTotals(kb, lines, elrs[s.key] ?? []) }
  })
  const reported = new Set(per.flatMap((s) => s.lines.filter((l) => l.concept && l.periodRole !== 'start').map((l) => l.concept)))
  const filed = new Set<string>()
  const out = { derived: {}, lines: {} } as DerivedFiling
  for (const s of per) {
    const extra: StatementLine[] = []
    for (const d of s.derived) {
      if (reported.has(d.concept) || filed.has(d.concept)) continue
      filed.add(d.concept)
      // StatementLine amounts are numbers, like the cells they come from: a sum of them is as exact as its parts
      extra.push({ concept: d.concept, cy: d.cy === null ? null : Number(d.cy), py: d.py === null ? null : Number(d.py) })
    }
    out.derived[s.key] = s.derived
    out.lines[s.key] = [...s.lines, ...extra]
  }
  return out
}
