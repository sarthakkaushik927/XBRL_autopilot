/** The side panel's Taxonomy and Masters activities for an Ind AS filing (ADR-0017). */
import { Building2, Pencil } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { LINE_SHEETS, PPE_TABLE, SOCIE_TABLE } from '@shared/indas'
import { useIndasElrs } from '@/app/workspace'
import { Button } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { TaxonomyPane } from './TaxonomyPane'
import { emptyMasterCount, parseRowId } from './workspace'

/**
 * Taxonomy search for the selected line: the concepts of its own sheet's scope (docs/15 §3). Clicking one tags the
 * line, as double-clicking it in the XBRL Form does.
 */
export function IndasTaxonomyPanel() {
  const s = useIndas(useShallow((x) => ({ rows: x.rows, selection: x.selection, activeElr: x.activeElr })))
  const elrs = useIndasElrs()
  const row = s.rows.find((r) => r.id === s.selection?.id)
  const kind = row?.statement ?? (s.selection ? parseRowId(s.selection.id)?.kind : undefined) ?? elrs.find((e) => e.uri === s.activeElr)?.kind
  const scope =
    LINE_SHEETS.find((l) => l.key === kind)?.sheet ?? (kind === 'socie' ? SOCIE_TABLE.sheet : kind === 'ppe' ? PPE_TABLE.sheet : 'CANONICAL_BS')
  const field = s.selection?.field ?? 'concept'
  const tagged = new Map<string, number>()
  for (const r of s.rows) if (r.concept) tagged.set(r.concept, (tagged.get(r.concept) ?? 0) + 1)
  return (
    <div className="flex h-full flex-col p-1">
      <TaxonomyPane
        scope={scope}
        kind={field}
        title={row ? `Tag: ${row.label}` : 'Select a line in Excel to tag it'}
        tagged={tagged}
        current={row?.concept ?? ''}
        suggested={(row?.suggestions ?? []).map((x) => x.qname)}
      />
    </div>
  )
}

export function IndasMastersSummary() {
  const { fields, company, auditor, signatories, setMastersOpen } = useIndas(
    useShallow((s) => ({ fields: s.fields, company: s.company, auditor: s.auditor, signatories: s.signatories, setMastersOpen: s.setMastersOpen })),
  )
  const empty = emptyMasterCount(fields, company, auditor)
  const signed = signatories.filter((x) => /^\d{8}$/.test(x.din.trim())).length
  return (
    <div className="flex flex-col gap-3 p-3 text-[12px]">
      <div className="flex items-center gap-2 font-medium">
        <Building2 size={14} /> Company, auditor & signatories
      </div>
      <ul className="flex flex-col gap-1 text-muted">
        <li className={empty ? 'text-warn' : 'text-ok'}>{empty ? `${empty} mandatory field(s) still empty` : 'Every mandatory field is filled'}</li>
        <li className={signed < 2 ? 'text-warn' : 'text-ok'}>{signed} signatory director(s) with a DIN (at least 2)</li>
      </ul>
      <Button className="self-start" onClick={() => setMastersOpen(true)}>
        <Pencil size={13} /> Edit details…
      </Button>
    </div>
  )
}
