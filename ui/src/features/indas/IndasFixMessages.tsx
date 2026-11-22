/**
 * Fix with AI in the left AI chat: each request is a "you asked" message and the AI's answer with one card per
 * proposed tag change (line → concept / opening balance, the reason, and the app's own dry run of it). Accept applies
 * that change only; the Difference check re-runs at once. Thin: the work is in stores/indas-fix.ts.
 */
import { Check, CircleAlert, Loader2, Sparkles, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { formatIndian } from '@xap/engine/basics'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useIndasFix, type FixSession } from '@/stores/indas-fix'
import { cardState, effectText, type FixCard } from './fix'

/** "ind-as:TradeReceivablesCurrent" → "TradeReceivablesCurrent" (a label is shown when one is known). */
const localName = (q: string) => q.slice(q.indexOf(':') + 1)

/** The Fix with AI sessions of the open Ind AS filing (nothing when none). */
export function IndasFixMessages() {
  const projectId = useIndas((s) => s.projectId)
  const sessions = useIndasFix(useShallow((s) => s.sessions.filter((x) => x.projectId === projectId)))
  if (!projectId || sessions.length === 0) return null
  return (
    <>
      {sessions.map((s) => (
        <Session key={s.id} session={s} />
      ))}
    </>
  )
}

/** Whether the chat has Fix with AI messages to show (the empty-chat prompts are hidden then). */
export function useHasFixSessions(): boolean {
  const projectId = useIndas((s) => s.projectId)
  return useIndasFix((s) => !!projectId && s.sessions.some((x) => x.projectId === projectId))
}

function Session({ session }: { session: FixSession }) {
  const { acceptAll, dismiss } = useIndasFix(useShallow((s) => ({ acceptAll: s.acceptAll, dismiss: s.dismiss })))
  const rows = useIndas((s) => s.rows)
  const open = session.cards.filter((c) => cardState(c, rows.find((r) => r.id === c.rowId)) === 'open')
  return (
    // AI text carries long unbroken qnames: let them wrap instead of widening the chat
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]" data-testid="fix-session" data-status={session.status}>
      <div className="flex flex-col items-end">
        <span className="mb-1 px-1 text-[10px] font-semibold text-muted">You</span>
        <div className="max-w-[95%] rounded-lg bg-accent px-3 py-2 text-xs text-accent-fg">
          <div className="font-medium">Fix with AI</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
            {session.problems.map((p) => (
              <li key={p.id}>{p.message}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col items-start">
        <div className="mb-1 flex w-full items-center gap-1.5 px-1">
          <Sparkles size={11} className="text-accent" />
          <span className="flex-1 text-[10px] font-semibold text-muted">AI Assistant</span>
          {session.status !== 'asking' && (
            <button className="text-muted hover:text-fg" onClick={() => dismiss(session.id)} title="Remove from the chat" aria-label="Remove">
              <X size={11} />
            </button>
          )}
        </div>
        <div className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs">
          {session.status === 'asking' && (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 size={12} className="animate-spin text-accent" /> Checking the tags against the taxonomy's calculations…
            </div>
          )}
          {session.status === 'failed' && (
            <div className="flex items-start gap-1.5 text-err" data-testid="fix-error">
              <CircleAlert size={12} className="mt-0.5 shrink-0" /> {session.error}
            </div>
          )}
          {session.status === 'ready' && (
            <>
              <p className="select-text whitespace-pre-line leading-relaxed" data-testid="fix-explanation">
                {session.explanation}
              </p>
              {session.cards.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted">No tag change proposed: check the figures in the workbook.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {session.cards.map((c) => (
                    <Card key={c.id} sessionId={session.id} card={c} />
                  ))}
                  {open.length > 1 && (
                    <Button variant="primary" className="h-6 w-full text-[11px]" onClick={() => acceptAll(session.id)} data-testid="fix-accept-all">
                      <Check size={11} className="mr-1" /> Accept all ({open.length})
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const STATE_TEXT: Record<Exclude<FixCard['state'], 'open'>, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  stale: 'The line was retagged since: ask again',
}

function Card({ sessionId, card }: { sessionId: string; card: FixCard }) {
  const { accept, reject } = useIndasFix(useShallow((s) => ({ accept: s.accept, reject: s.reject })))
  const row = useIndas((s) => s.rows.find((r) => r.id === card.rowId))
  const goTo = useIndas((s) => s.goToProblem)
  const state = cardState(card, row)
  const to = card.concept ? card.conceptLabel || localName(card.concept) : 'no tag'
  return (
    <div
      className={cn('min-w-0 overflow-hidden rounded border border-border bg-panel p-2', state !== 'open' && 'opacity-70')}
      data-testid="fix-card"
      data-state={state}
      data-row={card.rowId}
      data-concept={card.concept}
    >
      <button className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => goTo({ kind: 'line', rowId: card.rowId, which: 'label' })} title="Show the line in Excel">
        {row?.label ?? card.rowId}
      </button>
      {/* qnames are long and unbroken: the old tag is truncated (full on hover), the new one wraps anywhere */}
      <div className="mt-0.5 min-w-0 text-[11px]">
        <div className="truncate text-muted line-through" title={card.fromConcept || 'untagged'} data-testid="fix-from">
          {card.fromConcept ? localName(card.fromConcept) : 'untagged'}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
          <span className="text-muted">→</span>
          <span className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]" title={card.concept || undefined}>
            {to}
          </span>
          {card.periodRole && <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">{card.periodRole === 'start' ? 'opening balance' : 'closing balance'}</span>}
        </div>
      </div>
      <p className="mt-1 select-text text-[11px] leading-snug text-muted">{card.reason}</p>
      <div className={cn('mt-1 text-[10px]', card.effect.better ? 'text-ok' : 'text-warn')} data-testid="fix-effect" data-better={card.effect.better}>
        {card.effect.better ? '✓ ' : '! '}
        {effectText(card.effect, formatIndian)}
      </div>
      {state === 'open' ? (
        <div className="mt-1.5 flex gap-1.5">
          <Button variant="primary" className="h-6 px-2 text-[11px]" onClick={() => accept(sessionId, card.id)} data-testid="fix-accept">
            <Check size={11} className="mr-1" /> Accept
          </Button>
          <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => reject(sessionId, card.id)} data-testid="fix-reject">
            Reject
          </Button>
        </div>
      ) : (
        <div className={cn('mt-1.5 text-[10px] font-medium', state === 'accepted' ? 'text-ok' : 'text-muted')}>{STATE_TEXT[state]}</div>
      )}
    </div>
  )
}
