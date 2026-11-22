/**
 * Fix with AI for the Ind AS Problems panel: what is sent and how a proposal's cards stand. Pure (no React, no IPC;
 * ui/test/indas-fix.test.ts). The AI only proposes; a change is applied when the user accepts its card.
 */
import type { FixChange, FixLine, FixProblem, FixRequest } from '@shared/indas'
import type { TagRow } from './model'

/** The backend's limits (api/v1/schemas/indas_schema.py FixRequest). */
export const FIX_MAX_PROBLEMS = 50
export const FIX_MAX_LINES = 600

/**
 * The request for some totals that don't add up: the problems and every line of their statements (tagged or not, so
 * the AI can see a line that should carry a tag). Line items, headings, amounts and tags only: the request has no
 * field for the company name, CIN or DINs.
 */
export function fixRequestOf(problems: readonly FixProblem[], rows: readonly TagRow[]): FixRequest {
  const chosen = problems.slice(0, FIX_MAX_PROBLEMS)
  const statements = new Set(chosen.map((p) => p.statement))
  const lines: FixLine[] = rows
    .filter((r) => statements.has(r.statement))
    .slice(0, FIX_MAX_LINES)
    .map((r) => ({ id: r.id, statement: r.statement, label: r.label, headings: r.breadcrumb, cy: r.cy, py: r.py, concept: r.concept, periodRole: r.periodRole }))
  return { problems: chosen, lines }
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

/** "2 → 1 totals don't add up" / "Σ difference 1,22,000 → 0" for a card. */
export function effectText(e: FixChange['effect'], format: (v: string) => string): string {
  const issues = `${e.before} → ${e.after} total${e.after === 1 ? '' : 's'} off`
  return e.before === e.after ? `${issues}, difference ${format(e.totalBefore)} → ${format(e.totalAfter)}` : issues
}
