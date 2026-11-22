import { formatIndian } from '@xap/engine/basics'
import type { FormDifference } from '@shared/editor'
import { cn } from '@/lib/cn'

/** "Difference CY 0 · PY 0": whether the statement's own totals add up; green at 0. Click: its problems. */
export function DifferenceFooter(props: { difference: FormDifference; hasPy: boolean; onShow(): void }) {
  const d = props.difference
  const years = [['CY', d.cy], ...(props.hasPy ? [['PY', d.py]] : [])].filter((y): y is [string, string] => y[1] != null)
  const balanced = d.issues === 0 && years.every(([, v]) => v.replace(/[-0.,]/g, '') === '') // "0", "0.00", "-0": no float arithmetic on amounts
  return (
    <button
      className={cn('flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-left text-[11px] hover:bg-panel-2', balanced ? 'text-ok' : 'text-err')}
      onClick={props.onShow}
      title={balanced ? 'Every total of this statement adds up. Click to list its problems.' : `${d.issues} total${d.issues === 1 ? '' : 's'} of this statement don’t add up. Click to list them in Problems.`}
      data-testid="form-difference"
      data-balanced={balanced}
    >
      <span className="font-medium">Difference</span>
      {years.map(([label, v], i) => (
        <span key={label} className="tabular">
          {i > 0 && '· '}
          {label} {formatIndian(v)}
        </span>
      ))}
      {d.issues > 0 && <span className="text-muted">({d.issues} total{d.issues === 1 ? '' : 's'} don’t add up)</span>}
    </button>
  )
}
