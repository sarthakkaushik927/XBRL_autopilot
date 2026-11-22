/**
 * Read-only Excel view (Univer) with a tag overlay and two-way linkage. Presentational: what is highlighted, which
 * cell to reveal and what a click does come in as props, so a C&I filing (mapping) and an Ind AS filing (canonical
 * sheets) use the same grid (ADR-0017). Overlay colours are highlight layers, never cell styles: the workbook is
 * never modified.
 */
import { useEffect, useRef } from 'react'
import { createUniver, LocaleType, mergeLocales, type FUniver, type IDisposable } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import { cellKey, compactRanges, MAX_BLOCK_CELLS, MAX_RANGE_CELLS, rangeA1, rangeOf, type CellRef, type WorkbookModel } from '@shared/workbook'
import { registerTestHook } from '@/lib/test-hooks'
import { toUniverWorkbook } from './univer-data'

/** Overlay palette (docs/08-ui-ux.md "Mapping colours"). */
const STYLE = {
  approved: { fill: 'rgba(22,163,74,0.16)', stroke: 'rgba(22,163,74,0.75)' },
  suggested: { fill: 'rgba(217,119,6,0.18)', stroke: 'rgba(217,119,6,0.85)' },
  rejected: { fill: 'rgba(220,38,38,0.08)', stroke: 'rgba(220,38,38,0.6)' },
  linked: { fill: 'rgba(37,99,235,0.10)', stroke: 'rgba(37,99,235,1)' },
  /** a suggested table block: an outline only, so the cells' own colours show through */
  block: { fill: 'rgba(217,119,6,0)', stroke: 'rgba(217,119,6,0.95)' },
} as const

const overlayStyle = (s: { fill: string; stroke: string }, strokeWidth = 1, strokeDash?: number) => ({
  ...s,
  strokeWidth,
  ...(strokeDash ? { strokeDash } : {}),
  widgets: {},
  widgetSize: 0,
})

/** ~3 s of 100 ms tries: the grid is created after React's commit and a sheet renders a few frames after activation */
const REVEAL_RETRIES = 30

/** Shows a cell (activates its sheet, selects and scrolls to it). False while the grid can't do it yet. */
function revealCell(univerAPI: FUniver | null, cell: CellRef): boolean {
  const wb = univerAPI?.getActiveWorkbook()
  const ws = wb?.getSheetByName(cell.sheet)
  const at = rangeOf(cell.ref)
  if (!wb || !ws || !at) return false
  try {
    ws.activate()
    ws.getRange(cell.ref).activate()
    ws.scrollToCell(Math.max(0, at.r1 - 3), Math.max(0, at.c1 - 2))
    return true
  } catch {
    return false // render unit not registered yet
  }
}

/** The overlay: cells by tag status, suggested table blocks (outlined) and the cells linked to the selected fact. */
export interface GridMarks {
  approved: CellRef[]
  suggested: CellRef[]
  rejected?: CellRef[]
  blocks?: CellRef[]
  linked: CellRef[]
}

export interface UniverGridProps {
  model: WorkbookModel
  marks: GridMarks
  /** a request to show a cell; `seq` changes on every request */
  reveal: { cell: CellRef; seq: number } | null
  /** the selected cell (shown as data-cellkey for tests) */
  selected: CellRef | null
  /** a click / drag: the selected cell (a one-column run is a range) and, for a block over rows and columns, the block */
  onSelect(cell: CellRef, block: CellRef | null): void
  /** a double-click on the selected cell */
  onActivate?(cell: CellRef): void
  /** the user (or a reveal) switched the shown sheet */
  onSheetChange?(sheet: string): void
}

export function UniverGrid(props: UniverGridProps) {
  const { model, marks, reveal, selected } = props
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  // two overlay layers: the tag status colours, and the selected line (redrawn alone on every click)
  const statusLayer = useRef<IDisposable[]>([])
  const linkedLayer = useRef<IDisposable[]>([])
  // Univer's event handlers are registered once per workbook: they read the latest props through this ref
  const latest = useRef(props)
  latest.current = props

  // ---- create Univer for this workbook
  useEffect(() => {
    const el = host.current
    if (!el) return
    // Univer mounts/unmounts its own React roots. Doing that inside React's commit logs "Attempted to synchronously
    // unmount a root while React was already rendering", so creation and disposal both run after the commit. Deferring
    // creation also means StrictMode's throwaway mount creates nothing: two live Univer instances break event delivery.
    let instance: { dispose(): void } | null = null
    let subs: IDisposable[] = []
    let dblClickCleanup: (() => void) | null = null
    const create = setTimeout(() => {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
        presets: [
          UniverSheetsCorePreset({
            container: el,
            header: false,
            toolbar: false,
            formulaBar: false,
            contextMenu: false,
            footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: true },
          }),
        ],
      })
      instance = univer
      const wb = univerAPI.createWorkbook(toUniverWorkbook(model))
      wb.setEditable(false) // edits flowing back into the filing arrive in a later phase
      apiRef.current = univerAPI
      registerTestHook('univer', univerAPI)

      // Univer 1.4: the selection events (SelectionMoveEnd, not SelectionChanged) start firing only after the grid's
      // first few clicks, while CellPointerUp fires on every click and after a drag. The payloads' `selections` can be
      // empty, so the active range is read from the workbook itself. Univer also fires them for its own work (drawing
      // the overlay, a reveal), so only a changed selection is reported; a click always is (a repeat click re-focuses
      // the fact). Reporting every event looped: report → overlay redrawn → event → report (renderer out of memory).
      let lastSelection = ''
      const onSelection = () => {
        const wb = univerAPI.getActiveWorkbook()
        const range = wb?.getActiveRange()
        const ws = wb?.getActiveSheet()
        if (!range || !ws) return
        // a drag over several cells selects the range (tagged as their sum)
        let g = { r1: range.getRow(), c1: range.getColumn(), r2: range.getLastRow(), c2: range.getLastColumn() }
        // a block over several rows and columns can be mapped to a table ("Map as table"); the selection is its first cell
        const isBlock = g.c2 > g.c1 && g.r2 > g.r1 && (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) <= MAX_BLOCK_CELLS
        const block = isBlock ? { workbook: model.source, sheet: ws.getSheetName(), ref: rangeA1(g) } : null
        // only a one-column run of cells can be summed; a block, a whole column or the whole sheet means its first cell
        if (g.c2 !== g.c1 || g.r2 - g.r1 + 1 > MAX_RANGE_CELLS) g = { r1: g.r1, c1: g.c1, r2: g.r1, c2: g.c1 }
        const cell = { workbook: model.source, sheet: ws.getSheetName(), ref: rangeA1(g) }
        const key = `${cellKey(cell)}|${block?.ref ?? ''}`
        if (key === lastSelection) return
        lastSelection = key
        latest.current.onSelect(cell, block)
      }

      // Double-click interaction for manual XBRL tagging
      let lastClickTime = 0
      let lastCell = ''
      let lastOpenTime = 0

      const openTagModal = () => {
        const now = Date.now()
        if (now - lastOpenTime < 500) return
        lastOpenTime = now
        const cell = latest.current.selected
        if (cell) latest.current.onActivate?.(cell)
      }

      const onPointerUp = () => {
        lastSelection = ''
        onSelection()
        const now = Date.now()
        const cur = latest.current.selected
        const key = cur ? cellKey(cur) : ''
        if (key && key === lastCell && now - lastClickTime < 450) {
          lastClickTime = 0
          lastCell = ''
          openTagModal()
        } else {
          lastClickTime = now
          lastCell = key
        }
      }

      const onDblClick = () => {
        openTagModal()
      }
      el.addEventListener('dblclick', onDblClick)
      dblClickCleanup = () => el.removeEventListener('dblclick', onDblClick)

      subs = [
        univerAPI.addEvent(univerAPI.Event.CellPointerUp, onPointerUp),
        univerAPI.addEvent(univerAPI.Event.SelectionMoveEnd, onSelection),
        univerAPI.addEvent(univerAPI.Event.SelectionChanged, onSelection),
        univerAPI.addEvent(univerAPI.Event.ActiveSheetChanged, () => {
          drawOverlay()
          const name = univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetName()
          if (name) latest.current.onSheetChange?.(name)
        }),
      ]
      drawOverlay()
    }, 0)
    return () => {
      clearTimeout(create)
      if (dblClickCleanup) dblClickCleanup()
      subs.forEach((d) => d.dispose())
      clearLayer(statusLayer)
      clearLayer(linkedLayer)
      apiRef.current = null
      const univer = instance
      if (univer) setTimeout(() => univer.dispose(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // ---- overlay: tag status colours + the cells linked to the selected fact. Cells are merged into as few rectangles
  // as possible first: Univer re-sorts every shape on each add, so one shape per cell froze the window for minutes.
  function activeSheet() {
    const ws = apiRef.current?.getActiveWorkbook()?.getActiveSheet()
    if (!ws) return null
    const name = ws.getSheetName()
    const onSheet = (cells: CellRef[] | undefined) => compactRanges((cells ?? []).filter((c) => c.workbook === model.source && c.sheet === name).map((c) => c.ref))
    return { ws, onSheet }
  }

  function drawStatus(): void {
    clearLayer(statusLayer)
    const at = activeSheet()
    if (!at) return
    const m = latest.current.marks
    for (const status of ['approved', 'suggested', 'rejected'] as const) {
      const refs = at.onSheet(m[status])
      if (refs.length) statusLayer.current.push(at.ws.highlightRanges(refs.map((a1) => at.ws.getRange(a1)), overlayStyle(STYLE[status])))
    }
    const blocks = at.onSheet(m.blocks)
    if (blocks.length) statusLayer.current.push(at.ws.highlightRanges(blocks.map((a1) => at.ws.getRange(a1)), overlayStyle(STYLE.block, 2, 8)))
  }

  function drawLinked(): void {
    clearLayer(linkedLayer)
    const at = activeSheet()
    const linked = at?.onSheet(latest.current.marks.linked) ?? []
    if (at && linked.length) linkedLayer.current.push(at.ws.highlightRanges(linked.map((a1) => at.ws.getRange(a1)), overlayStyle(STYLE.linked, 2)))
  }

  function drawOverlay(): void {
    drawStatus()
    drawLinked()
  }

  useEffect(drawStatus, [marks.approved, marks.suggested, marks.rejected, marks.blocks])
  useEffect(drawLinked, [marks.linked])

  // ---- reveal requests from the XBRL side (Form/XML/Inspector)
  // Univer registers a sheet's render unit some frames after the grid (or a newly activated sheet) appears; until then
  // scrollToCell throws. A throw inside an effect unmounts the whole React tree (a white window), so the reveal is
  // retried a few frames later and never throws.
  useEffect(() => {
    if (!reveal || reveal.cell.workbook !== model.source) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (left: number) => {
      if (revealCell(apiRef.current, reveal.cell)) return drawOverlay()
      if (left > 0) timer = setTimeout(() => attempt(left - 1), 100)
    }
    attempt(REVEAL_RETRIES)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq])

  return <div ref={host} className="univer-host h-full w-full" data-testid="univer-host" data-cellkey={selected ? cellKey(selected) : ''} />
}

function clearLayer(layer: { current: IDisposable[] }): void {
  layer.current.forEach((d) => d.dispose())
  layer.current = []
}
