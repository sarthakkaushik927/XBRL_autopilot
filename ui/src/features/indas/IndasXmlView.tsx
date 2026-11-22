/** The XML tab of an Ind AS filing (ADR-0017): the instance /generateXML wrote. Loaded lazily (Monaco). */
import { CircleCheck, FileCode2, FolderOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { XmlCode } from '@/features/xbrl/XmlView'

export function IndasXmlView() {
  const { result, busy, transform, generate } = useIndas(useShallow((s) => ({ result: s.result, busy: s.busy, transform: s.transform, generate: s.generate })))
  if (!result?.ok) {
    return (
      <EmptyState icon={FileCode2} title={result ? 'The XML was not generated' : 'No XML yet'}>
        <p>{result ? 'The MCA checks found problems: see the Problems panel, fix them and generate again.' : 'Generate XML validates the filing with the MCA rules and writes the AOC-4 instance to the projects folder.'}</p>
        <div className="mt-3">
          <Button variant="primary" disabled={!!busy || !transform} onClick={() => void generate()}>
            <FileCode2 size={14} /> Generate XML
          </Button>
        </div>
      </EmptyState>
    )
  }
  return (
    <XmlCode
      xml={result.xml}
      status={
        <span className="flex items-center gap-1.5 text-ok" data-testid="xml-status">
          <CircleCheck size={13} /> Passes the MCA checks · {result.fileName} ({result.sizeKb} KB)
          <button className="ml-2 inline-flex items-center gap-1 text-muted hover:text-fg" onClick={() => void window.xap.indas.showGenerated()} title={result.path}>
            <FolderOpen size={12} /> Show in folder
          </button>
        </span>
      }
    />
  )
}
