/**
 * Master-data form fields from the knowledge base (docs/17): the mandatory company and auditor items.
 *
 * Nothing is hardcoded: the fields are the non-abstract, non-table concepts the MCA rules mark mandatory for the
 * general-information and auditor ELRs. `/indas/generateXML` checks the same `mandatoryByELR` list.
 */
import type { MasterField, MasterFields } from '@shared/indas'
import { conceptLabel, type IndasKnowledgeBase } from './indas-knowledge-base'

const COMPANY_ELR = '700300' // general information about the financial statements
const AUDITOR_ELR = '700400' // auditor's report

function field(kb: IndasKnowledgeBase, qname: string): MasterField | null {
  const c = kb.concepts?.[qname]
  if (!c || c.abstract || qname.endsWith('Table') || qname.endsWith('Abstract')) return null
  return { qname, label: conceptLabel(kb, qname), type: c.type || 'stringItemType' }
}

export function masterFieldsOf(kb: IndasKnowledgeBase): MasterFields {
  const byElr = kb.businessRules?.mandatoryByELR ?? {}
  const fields = (elr: string) => (byElr[elr] ?? []).map((q) => field(kb, q)).filter((f): f is MasterField => f !== null)
  return { company: fields(COMPANY_ELR), auditor: fields(AUDITOR_ELR) }
}
