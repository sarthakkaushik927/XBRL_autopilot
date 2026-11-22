import { Copy, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The green "from cell" chip of a value in the XBRL Form (e.g. `E12`); accent when that cell is selected in Excel. */
export function CellChip(props: { text: string; title: string; active?: boolean; also?: boolean; onClick?(): void }) {
  return (
    <span
      className={cn('flex items-center gap-0.5 rounded bg-ok/15 px-1 font-mono text-[10px] text-ok', props.active && 'bg-accent/20 text-accent', props.onClick && 'cursor-pointer')}
      title={props.title}
      onClick={
        props.onClick &&
        ((e) => {
          e.stopPropagation()
          props.onClick!()
        })
      }
      data-testid="source-chip"
    >
      {props.also ? <Copy size={9} /> : <FileSpreadsheet size={9} />}
      {props.text}
    </span>
  )
}
