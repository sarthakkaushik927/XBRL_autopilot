/**
 * Fix with AI for the Ind AS Problems panel (Sarthak, 2026-11-22): each request is a session shown in the left AI
 * chat as one message with a card per proposed change. Accept applies that one change through the Ind AS store
 * (setConcept / setPeriodRole), which re-runs the Difference check; the AI never writes a tag itself.
 */
import { create } from 'zustand'
import type { FixProblem } from '@shared/indas'
import { cardState, fixRequestOf, type FixCard } from '@/features/indas/fix'
import { unwrap } from '@/lib/result'
import { useIndas } from './indas'
import { toast } from './toast'
import { useUi } from './ui'

export interface FixSession {
  id: string
  /** the project it belongs to: sessions of another project are not shown */
  projectId: string
  problems: FixProblem[]
  status: 'asking' | 'ready' | 'failed'
  error: string | null
  explanation: string
  cards: FixCard[]
}

interface IndasFixState {
  sessions: FixSession[]
  /** asks the AI for the given totals; the chat opens on the left and shows the answer as cards */
  ask(problems: FixProblem[]): Promise<void>
  accept(sessionId: string, cardId: string): void
  reject(sessionId: string, cardId: string): void
  /** accepts every open card of the session, in order */
  acceptAll(sessionId: string): void
  dismiss(sessionId: string): void
}

let seq = 0

export const useIndasFix = create<IndasFixState>((set, get) => {
  const patchSession = (id: string, patch: (s: FixSession) => Partial<FixSession>) =>
    set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, ...patch(s) } : s)) })
  const setCard = (sessionId: string, cardId: string, state: FixCard['state']) =>
    patchSession(sessionId, (s) => ({ cards: s.cards.map((c) => (c.id === cardId ? { ...c, state } : c)) }))

  /** applies one card; false when the line changed since the AI was asked (the card turns stale) */
  const apply = (sessionId: string, card: FixCard): boolean => {
    const indas = useIndas.getState()
    const row = indas.rows.find((r) => r.id === card.rowId)
    if (cardState(card, row) !== 'open') {
      setCard(sessionId, card.id, 'stale')
      return false
    }
    if (card.concept !== row!.concept) indas.setConcept(card.rowId, card.concept)
    if (card.periodRole && card.concept) indas.setPeriodRole(card.rowId, card.periodRole)
    setCard(sessionId, card.id, 'accepted')
    return true
  }

  return {
    sessions: [],

    ask: async (problems) => {
      const indas = useIndas.getState()
      if (!indas.open || problems.length === 0) return
      const id = `fix-${++seq}`
      set({ sessions: [...get().sessions, { id, projectId: indas.projectId, problems, status: 'asking', error: null, explanation: '', cards: [] }] })
      useUi.getState().showActivity('ai')
      let error: string | null = null
      const proposal = await unwrap(window.xap.indas.fix(fixRequestOf(problems, indas.rows)), { quietWhen: (e) => ((error = e.message), true) })
      if (!proposal) return patchSession(id, () => ({ status: 'failed', error: error ?? 'The AI could not propose a fix.' }))
      patchSession(id, () => ({ status: 'ready', explanation: proposal.explanation, cards: proposal.changes.map((c) => ({ ...c, state: 'open' as const })) }))
    },

    accept: (sessionId, cardId) => {
      const card = get().sessions.find((s) => s.id === sessionId)?.cards.find((c) => c.id === cardId)
      if (card && !apply(sessionId, card)) toast.info('That line was retagged after the AI was asked: ask again for a fresh proposal.')
    },

    reject: (sessionId, cardId) => setCard(sessionId, cardId, 'rejected'),

    acceptAll: (sessionId) => {
      const cards = get().sessions.find((s) => s.id === sessionId)?.cards.filter((c) => c.state === 'open') ?? []
      const applied = cards.filter((c) => apply(sessionId, c)).length
      if (applied < cards.length) toast.info(`Applied ${applied} of ${cards.length}: the other lines were retagged after the AI was asked.`)
    },

    dismiss: (sessionId) => set({ sessions: get().sessions.filter((s) => s.id !== sessionId) }),
  }
})
