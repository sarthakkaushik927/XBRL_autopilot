/** The Preview tab of an Ind AS filing (ADR-0017): an MCA-like preview of the tagged statements. */
import { ScrollText } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LINE_SHEETS, type StatementKey } from '@shared/indas'
import { useIndasElrs } from '@/app/workspace'
import { EmptyState } from '@/components/EmptyState'
import { useIndas } from '@/stores/indas'
import { formLines, previewHtml, taggedOf, treeOf } from './workspace'

export function IndasPreviewView() {
  const s = useIndas(useShallow((x) => ({ details: x.details, trees: x.trees, checks: x.checks, rows: x.rows, socie: x.socie, ppe: x.ppe, texts: x.texts })))
  const elrs = useIndasElrs()
  const html = useMemo(() => {
    if (!s.details) return ''
    const sections = elrs.flatMap((e) => {
      const tree = treeOf(s.trees, e)
      if (!tree || !LINE_SHEETS.some((l) => l.key === e.kind)) return []
      const kind = e.kind as StatementKey
      return [{ title: e.title, code: e.code, lines: formLines(tree, s.checks[kind]?.facts ?? {}, taggedOf(kind, s)) }]
    })
    return previewHtml(s.details, sections, s.texts)
  }, [s, elrs])
  if (!html) return <EmptyState icon={ScrollText} title="Nothing to preview" />
  return (
    <div className="flex h-full flex-col" data-testid="preview">
      <div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted">Preview of the tagged statements — the official PDF comes from the MCA tool.</div>
      <iframe title="Filing preview" sandbox="" srcDoc={html} className="min-h-0 flex-1 bg-white" data-testid="preview-frame" />
    </div>
  )
}
