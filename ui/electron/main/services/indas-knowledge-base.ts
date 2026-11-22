/**
 * The parts of the Ind AS knowledge base (GET /api/v1/indas/authority) the app reads on the client side:
 * concept labels and types, the calculation network and the MCA mandatory-by-ELR lists.
 */
export interface KbConcept {
  name?: string
  type?: string
  abstract?: boolean
  labels?: { label?: string }
}

export interface KbCalculation {
  from: string
  to: string
  weight: number | string
}

export interface IndasKnowledgeBase {
  concepts?: Record<string, KbConcept>
  calculation?: Record<string, KbCalculation[]>
  businessRules?: { mandatoryByELR?: Record<string, string[]> }
}

/** A concept's standard label, else its name, else the qname. */
export function conceptLabel(kb: IndasKnowledgeBase, qname: string): string {
  const c = kb.concepts?.[qname]
  return c?.labels?.label || c?.name || qname
}
