/**
 * Fix with AI's deterministic half (CLAUDE.md non-negotiable 2): each change the AI proposes is tried alone on its
 * statement with the same Difference check the editor runs live, so the card can say what accepting it does
 * ("2 → 1 totals don't add up") before the user accepts. Pure: no IPC, no sidecar.
 */
import { decimal as Dec } from '@xap/engine'
import type { FixChange, FixLine, PeriodRole, StatementLine } from '@shared/indas'
import { checkDifferences, checkedTotals } from './indas-difference-check'
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

/** The tagged lines of one statement, as the Difference check reads them. */
function statementLines(lines: readonly FixLine[], statement: string): StatementLine[] {
  return lines.filter((l) => l.statement === statement && l.concept).map((l) => ({ concept: l.concept, cy: l.cy, py: l.py, periodRole: l.periodRole }))
}

/** Totals off and Σ |difference| of a statement; `keep` = totals still compared when their parts lose their tags. */
function measure(kb: IndasKnowledgeBase, lines: readonly FixLine[], statement: string, keep?: ReadonlySet<string>) {
  const r = checkDifferences(kb, statementLines(lines, statement), keep)
  return { issues: r.differences.length, total: r.total }
}

/** Applies one change to the lines (the line gets its new concept / period role). */
export function applyChange(lines: readonly FixLine[], change: Pick<ProposedChange, 'rowId' | 'concept' | 'periodRole'>): FixLine[] {
  return lines.map((l) => (l.id !== change.rowId ? l : { ...l, concept: change.concept, periodRole: change.periodRole ?? l.periodRole }))
}

/** Each proposed change on a known line, with its effect alone; changes on lines the request didn't have are dropped. */
export function dryRun(kb: IndasKnowledgeBase, lines: readonly FixLine[], proposed: readonly ProposedChange[]): FixChange[] {
  const before = new Map<string, { issues: number; total: string; keep: Set<string> }>()
  const out: FixChange[] = []
  proposed.forEach((p, i) => {
    const line = lines.find((l) => l.id === p.rowId)
    if (!line) return
    const b = before.get(line.statement) ?? { ...measure(kb, lines, line.statement), keep: checkedTotals(kb, statementLines(lines, line.statement)) }
    before.set(line.statement, b)
    // a total checked now stays checked: untagging its last part must not look like a fix
    const a = measure(kb, applyChange(lines, p), line.statement, b.keep)
    out.push({
      id: `${i}:${p.rowId}`,
      problemId: p.problemId,
      rowId: p.rowId,
      fromConcept: line.concept,
      concept: p.concept,
      conceptLabel: p.conceptLabel,
      ...(p.periodRole ? { periodRole: p.periodRole } : {}),
      reason: p.reason,
      effect: { before: b.issues, after: a.issues, totalBefore: b.total, totalAfter: a.total, better: improves(b, a) },
    })
  })
  return out
}

/** Whether the change makes things better: fewer totals off, or as many with a smaller Σ |difference|. */
function improves(before: { issues: number; total: string }, after: { issues: number; total: string }): boolean {
  if (after.issues !== before.issues) return after.issues < before.issues
  return Dec.cmp(Dec.parse(after.total), Dec.parse(before.total)) < 0
}
