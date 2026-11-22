/** Workbook model (what the Excel pane shows) + cell reference helpers. Pure: shared by main and renderer. */

export interface CellRef {
  /** source name inside the project, e.g. "workbook-1.xlsx" */
  workbook: string
  sheet: string
  /** A1 reference, e.g. "C9" */
  ref: string
}

export type CellValue = string | number | boolean | null

export interface CellModel {
  /** 0-based row / column */
  r: number
  c: number
  v: CellValue
  /** formula without "=", when the cell had one (v is its cached result) */
  f?: string
  bold?: boolean
  italic?: boolean
  indent?: number
  numFmt?: string
}

export interface SheetModel {
  name: string
  rowCount: number
  colCount: number
  cells: CellModel[]
  merges: { r1: number; c1: number; r2: number; c2: number }[]
  /** 0-based column → width in Excel character units */
  colWidths: Record<number, number>
  /** set when the sheet was too large to show whole (a working-paper dump): only the first rows are kept */
  truncated?: { totalCells: number; keptRows: number }
}

export interface WorkbookModel {
  source: string
  fileName: string
  sheets: SheetModel[]
}

export function columnLetter(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function toA1(r: number, c: number): string {
  return `${columnLetter(c)}${r + 1}`
}

/** "C9" → { r: 8, c: 2 }; null for anything that isn't a single A1 cell. */
export function fromA1(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref.toUpperCase())
  if (!m) return null
  let c = 0
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

export function cellKey(ref: CellRef): string {
  return `${ref.workbook}|${ref.sheet}|${ref.ref}`
}

export function sameCell(a: CellRef | null | undefined, b: CellRef | null | undefined): boolean {
  return !!a && !!b && a.workbook === b.workbook && a.sheet === b.sheet && a.ref === b.ref
}

export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** "C9" or "D22:D23" (either corner order) → normalised 0-based range; null for anything else. */
export function rangeOf(ref: string): CellRange | null {
  const [a, b, extra] = ref.split(':')
  if (extra !== undefined || !a) return null
  const p = fromA1(a)
  const q = b === undefined ? p : fromA1(b)
  if (!p || !q) return null
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) }
}

/** A1 of a range: "C9" for one cell, "D22:D23" otherwise. */
export function rangeA1(g: CellRange): string {
  const a = toA1(g.r1, g.c1)
  return g.r1 === g.r2 && g.c1 === g.c2 ? a : `${a}:${toA1(g.r2, g.c2)}`
}

/**
 * Largest range the app expands into cells. A whole-column or whole-sheet selection is ~10⁶–10¹⁰ cells: expanding it
 * crashed the renderer (out of memory, black window).
 */
export const MAX_RANGE_CELLS = 1000

/** The largest range "Map as table" maps to one taxonomy table (ADR-0013). */
export const MAX_BLOCK_CELLS = 5_000

/** Number of cells in a reference, computed (never expanded); 0 when it isn't one. */
export function rangeSize(ref: string): number {
  const g = rangeOf(ref)
  return g ? (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) : 0
}

/** Every cell of a reference, as A1 ("D22:D23" → ["D22", "D23"]); [] beyond MAX_RANGE_CELLS. */
export function rangeCells(ref: string): string[] {
  const g = rangeOf(ref)
  if (!g || rangeSize(ref) > MAX_RANGE_CELLS) return []
  const out: string[] = []
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push(toA1(r, c))
  return out
}

/**
 * The fewest rectangles covering the given cells / ranges (A1, one sheet): runs of rows in a column join, then
 * neighbouring columns with the same run. The grid draws one shape per range, and Univer re-sorts every shape on each
 * add, so 537 single cells took minutes to draw (PR #15 review: "the app hangs") where a handful of ranges is instant.
 * A range larger than MAX_RANGE_CELLS is kept as it is.
 */
export function compactRanges(refs: readonly string[]): string[] {
  const rowsByCol = new Map<number, Set<number>>()
  const kept: string[] = []
  for (const ref of refs) {
    const g = rangeOf(ref)
    if (!g) continue
    if (rangeSize(ref) > MAX_RANGE_CELLS) {
      kept.push(rangeA1(g))
      continue
    }
    for (let c = g.c1; c <= g.c2; c++) {
      const rows = rowsByCol.get(c) ?? new Set<number>()
      for (let r = g.r1; r <= g.r2; r++) rows.add(r)
      rowsByCol.set(c, rows)
    }
  }
  // vertical runs per column, keyed by their rows so equal runs of neighbouring columns can join
  const runs = new Map<string, number[]>()
  for (const [c, set] of rowsByCol) {
    const rows = [...set].sort((a, b) => a - b)
    for (let i = 0; i < rows.length; ) {
      let j = i
      while (j + 1 < rows.length && rows[j + 1] === rows[j]! + 1) j++
      const key = `${rows[i]}:${rows[j]}`
      runs.set(key, [...(runs.get(key) ?? []), c])
      i = j + 1
    }
  }
  const out: CellRange[] = []
  for (const [key, cols] of runs) {
    const [r1, r2] = key.split(':').map(Number) as [number, number]
    cols.sort((a, b) => a - b)
    for (let i = 0; i < cols.length; ) {
      let j = i
      while (j + 1 < cols.length && cols[j + 1] === cols[j]! + 1) j++
      out.push({ r1, r2, c1: cols[i]!, c2: cols[j]! })
      i = j + 1
    }
  }
  out.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1)
  return [...kept, ...out.map(rangeA1)]
}

/** Do two references on the same workbook and sheet share a cell? */
export function overlaps(a: CellRef, b: CellRef): boolean {
  if (a.workbook !== b.workbook || a.sheet !== b.sheet) return false
  const p = rangeOf(a.ref)
  const q = rangeOf(b.ref)
  return !!p && !!q && p.r1 <= q.r2 && q.r1 <= p.r2 && p.c1 <= q.c2 && q.c1 <= p.c2
}

/** The value of one cell of the loaded workbooks (null when the cell is empty or not loaded). */
export function cellValueAt(workbooks: WorkbookModel[], ref: CellRef): CellValue {
  const at = fromA1(ref.ref)
  const sheet = workbooks.find((w) => w.source === ref.workbook)?.sheets.find((s) => s.name === ref.sheet)
  if (!at || !sheet) return null
  return sheet.cells.find((c) => c.r === at.r && c.c === at.c)?.v ?? null
}
