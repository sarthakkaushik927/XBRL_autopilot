/**
 * Fix with AI for the Ind AS Problems panel: what is sent and how a proposal's cards stand. Pure (no React, no IPC;
 * ui/test/indas-fix.test.ts). The AI only proposes; a change is applied when the user accepts its card.
 */
import type { FixChange, FixLine, FixProblem, FixRequest, StatementElrs } from '@shared/indas'
import type { TagRow } from './model'

/** The backend's limits (api/v1/schemas/indas_schema.py FixRequest). */
export const FIX_MAX_PROBLEMS = 50
export const FIX_MAX_LINES = 600

/**
 * The request for some totals that don't add up: the problems and every line of their statements (tagged or not, so
 * the AI can see a line that should carry a tag). Line items, headings, amounts and tags only: the request has no
 * field for the company name, CIN or DINs. `elrs` (each statement's ELRs) lets the dry run derive the same totals as
 * the live check.
 */
export function fixRequestOf(problems: readonly FixProblem[], rows: readonly TagRow[], elrs: StatementElrs = {}): FixRequest {
  const chosen = problems.slice(0, FIX_MAX_PROBLEMS)
  const statements = new Set(chosen.map((p) => p.statement))
  const line = (r: TagRow): FixLine => ({ id: r.id, statement: r.statement, label: r.label, headings: r.breadcrumb, cy: r.cy, py: r.py, concept: r.concept, periodRole: r.periodRole })
  const lines = rows.filter((r) => statements.has(r.statement)).slice(0, FIX_MAX_LINES).map(line)
  // the dry run scores each change on the whole filing (main only: the backend gets `lines`)
  const sent = new Set(lines.map((l) => l.id))
  const filing = [...lines, ...rows.filter((r) => r.concept && !sent.has(r.id)).map(line)]
  return { problems: chosen, lines, filing, elrs }
}

/** A card's state: waiting for the user, done, declined, or no longer applicable (the line changed since). */
export type CardState = 'open' | 'accepted' | 'rejected' | 'stale'

export interface FixCard extends FixChange {
  state: CardState
}

/** Whether the card can still be applied to the line as it is now. */
export function cardState(card: FixCard, row: Pick<TagRow, 'concept'> | undefined): CardState {
  if (card.state !== 'open') return card.state
  return row && row.concept === card.fromConcept ? 'open' : 'stale'
}

/** "5 → 3 problems" / "…, difference 1,22,000 → 0" for a card (the whole filing: totals off + Generate's rules). */
export function effectText(e: FixChange['effect'], format: (v: string) => string): string {
  const issues = `${e.before} → ${e.after} problem${e.after === 1 ? '' : 's'}`
  return e.before === e.after ? `${issues}, difference ${format(e.totalBefore)} → ${format(e.totalAfter)}` : issues
}
