/**
 * Fix with AI's deterministic half (CLAUDE.md non-negotiable 2): each change the AI proposes is tried on the whole
 * filing before the user sees it, with the live Difference check of every statement plus the statement rules
 * Generate applies (duplicate facts, totals across statements, the balance sheet, non-negative amounts). The card
 * then says what accepting it does ("5 → 3 problems"), and a change that fixes one total but breaks another
 * statement is not marked helpful (issue #20, point 4).
 *
 * Accept all takes only the changes that help **together**: the helpful ones are applied in order and each is kept
 * only when it still helps on top of the ones kept before it (two changes to one line, or two that undo each other,
 * can't both be kept). Pure: no IPC, no sidecar.
 */
import { decimal as Dec } from '@xap/engine'
import { LINE_SHEETS, type FixChange, type FixLine, type PeriodRole, type StatementLine } from '@shared/indas'
import { checkDifferences, checkedTotals } from './indas-difference-check'
import { filingRuleErrors } from './indas-filing-rules'
import type { IndasKnowledgeBase } from './indas-knowledge-base'

/** A change as the backend returns it (before the app's dry run). */
export interface ProposedChange {
  problemId: string
  rowId: string
  concept: string
  conceptLabel: string
  periodRole?: PeriodRole
  reason: string
}

interface Score {
  issues: number
  /** of which Generate's statement rules (duplicates, negatives, totals across statements) */
  rules: number
  total: string
}

/** The tagged lines of one statement, as the checks read them. */
function statementLines(lines: readonly FixLine[], statement: string): StatementLine[] {
  return lines.filter((l) => l.statement === statement && l.concept).map((l) => ({ concept: l.concept, cy: l.cy, py: l.py, periodRole: l.periodRole }))
}

type Keep = ReadonlyMap<string, ReadonlySet<string>>
const KEEP_NONE: Keep = new Map()

/**
 * The filing's problems: totals off in each statement (CY and PY) + Generate's statement rules, and Σ |difference|.
 * `keep` = per statement, totals still compared after their parts lost their tags (see `untagKeep`).
 */
function measure(kb: IndasKnowledgeBase, lines: readonly FixLine[], keep: Keep = KEEP_NONE): Score {
  let issues = 0
  const gaps: string[] = []
  const offCy = new Set<string>()
  const statements = LINE_SHEETS.map((s) => statementLines(lines, s.key))
  LINE_SHEETS.forEach((s, i) => {
    const r = checkDifferences(kb, statements[i], keep.get(s.key))
    issues += r.differences.length
    for (const d of r.differences) if (d.year === 'CY') offCy.add(d.concept)
    gaps.push(r.total)
  })
  // a CY total already off in its statement is one problem, not two (Generate's own calculation check sees it too)
  const rules = filingRuleErrors(kb, statements).filter((e) => !((e.type === 'CALCULATION_MISMATCH' || e.type === 'BS_OUT_OF_BALANCE') && offCy.has(e.concept))).length
  return { issues: issues + rules, rules, total: Dec.toString(Dec.sum(gaps.map((g) => Dec.parse(g)))) }
}

/** Applies one change to the lines (the line gets its new concept / period role). */
export function applyChange(lines: readonly FixLine[], change: Pick<ProposedChange, 'rowId' | 'concept' | 'periodRole'>): FixLine[] {
  return lines.map((l) => (l.id !== change.rowId ? l : { ...l, concept: change.concept, periodRole: change.periodRole ?? l.periodRole }))
}

/**
 * Untagging a total's last tagged part must not look like a fix: the totals the untagged lines were parts of, and
 * that were compared before, stay compared. Only for untagging: a part retagged to another total leaves its old total
 * with no tagged part, which neither the live check nor Generate compares, so the dry run doesn't either.
 */
function untagKeep(kb: IndasKnowledgeBase, filing: readonly FixLine[], changes: readonly ProposedChange[]): Keep {
  const untagged = changes.filter((c) => !c.concept).map((c) => filing.find((l) => l.id === c.rowId)).filter((l): l is FixLine => !!l?.concept)
  if (untagged.length === 0) return KEEP_NONE
  const out = new Map<string, Set<string>>()
  for (const s of LINE_SHEETS) {
    const lost = new Set(untagged.filter((l) => l.statement === s.key).map((l) => l.concept))
    if (lost.size === 0) continue
    const before = checkedTotals(kb, statementLines(filing, s.key))
    const parents = new Set<string>()
    for (const eqs of Object.values(kb.calculation ?? {})) for (const eq of eqs) if (lost.has(eq.to) && before.has(eq.from)) parents.add(eq.from)
    out.set(s.key, parents)
  }
  return out
}

/**
 * Each proposed change on a known line, with its effect alone on the whole filing (`filing` = every line of every
 * statement) and whether Accept all keeps it; changes on lines the request didn't have are dropped.
 */
export function dryRun(kb: IndasKnowledgeBase, filing: readonly FixLine[], proposed: readonly ProposedChange[]): FixChange[] {
  const before = measure(kb, filing)
  const known = proposed.filter((p) => filing.some((l) => l.id === p.rowId))
  const alone = known.map((p) => measure(kb, applyChange(filing, p), untagKeep(kb, filing, [p])))

  // Accept all: the helpful changes in order, each kept only when it still helps on top of the ones kept before
  let state = filing
  let score = before
  const kept: ProposedChange[] = []
  const together = known.map((p, i) => {
    if (!improves(before, alone[i])) return false
    const next = applyChange(state, p)
    const s = measure(kb, next, untagKeep(kb, filing, [...kept, p]))
    if (!improves(score, s)) return false
    state = next
    score = s
    kept.push(p)
    return true
  })

  return known.map((p, i) => ({
    id: `${i}:${p.rowId}`,
    problemId: p.problemId,
    rowId: p.rowId,
    fromConcept: filing.find((l) => l.id === p.rowId)!.concept,
    concept: p.concept,
    conceptLabel: p.conceptLabel,
    ...(p.periodRole ? { periodRole: p.periodRole } : {}),
    reason: p.reason,
    effect: { before: before.issues, after: alone[i].issues, totalBefore: before.total, totalAfter: alone[i].total, better: improves(before, alone[i]), together: together[i] },
  }))
}

/**
 * Whether the change makes things better: fewer problems, or as many with a smaller Σ |difference| and no new rule
 * broken (a fixed total traded for a duplicate fact is not better).
 */
function improves(before: Score, after: Score): boolean {
  if (after.issues !== before.issues) return after.issues < before.issues
  return after.rules <= before.rules && Dec.cmp(Dec.parse(after.total), Dec.parse(before.total)) < 0
}
