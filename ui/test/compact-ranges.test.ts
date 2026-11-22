import { describe, expect, it } from 'vitest'
import { compactRanges, rangeCells } from '../shared/workbook'

const covered = (refs: string[]) => new Set(refs.flatMap(rangeCells))

describe('compactRanges', () => {
  it('joins runs of rows in a column, then neighbouring columns with the same run', () => {
    expect(compactRanges(['A2', 'A3', 'A4', 'B2', 'B3', 'B4', 'C2', 'C3', 'C4'])).toEqual(['A2:C4'])
    expect(compactRanges(['A2', 'A3', 'A5'])).toEqual(['A2:A3', 'A5'])
  })

  it('keeps separate columns apart and covers exactly the same cells', () => {
    const cells = ['A2', 'C2', 'A3', 'C3', 'B7', 'A9']
    const out = compactRanges(cells)
    expect(out).toEqual(['A2:A3', 'C2:C3', 'B7', 'A9'])
    expect(covered(out)).toEqual(new Set(cells))
  })

  it('turns a sheet of tagged lines (label + CY + PY per row) into one shape per run', () => {
    // 179 note rows, columns A, D, E: 537 cells — the overlay that froze the window
    const cells = Array.from({ length: 179 }, (_, i) => [`A${i + 2}`, `D${i + 2}`, `E${i + 2}`]).flat()
    expect(compactRanges(cells)).toEqual(['A2:A180', 'D2:E180'])
  })

  it('accepts ranges, ignores junk and keeps a huge range as it is', () => {
    expect(compactRanges(['B2:B3', 'B4', 'nonsense'])).toEqual(['B2:B4'])
    expect(compactRanges(['A1:Z1000'])).toEqual(['A1:Z1000'])
  })
})
