/** The C&I filing's grid: the engine mapping as the overlay, and clicks / double-clicks into the editor store. */
import { useMemo } from 'react'
import type { WorkbookModel } from '@shared/workbook'
import { useEditor } from '@/stores/editor'
import { UniverGrid, type GridMarks } from './UniverGrid'

export function EditorGrid({ model }: { model: WorkbookModel }) {
  const mappings = useEditor((s) => s.mappings)
  const blockSuggestions = useEditor((s) => s.blockSuggestions)
  const selection = useEditor((s) => s.selection)
  const byFact = useEditor((s) => s.byFact)
  const reveal = useEditor((s) => s.reveal)

  const marks = useMemo<GridMarks>(() => {
    // every source of a summed tag is highlighted (ADR-0015)
    const of = (status: string) => mappings.filter((m) => m.status === status).flatMap((m) => m.sources.map((s) => s.cell))
    return {
      approved: of('approved'),
      suggested: of('suggested'),
      rejected: of('rejected'),
      blocks: blockSuggestions.filter((b) => b.status === 'suggested').map((b) => b.cell),
      linked: selection.factKey ? (byFact.get(selection.factKey)?.sources ?? []).map((s) => s.cell) : [],
    }
  }, [mappings, blockSuggestions, selection.factKey, byFact])

  return (
    <UniverGrid
      model={model}
      marks={marks}
      reveal={reveal}
      selected={selection.cell}
      onSelect={(cell, block) => {
        const editor = useEditor.getState()
        editor.setBlockRange(block)
        editor.selectCell(cell)
      }}
      onActivate={(cell) => useEditor.getState().openManualTag({ cell })}
    />
  )
}
