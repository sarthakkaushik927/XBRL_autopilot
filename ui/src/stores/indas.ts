/**
 * Renderer state of an open Ind AS filing (docs/17, ADR-0017): the canonical sheets, their tags, the masters and the
 * editor's selection. It feeds the same editor as a C&I filing (Filing Explorer, Excel pane, XBRL Form, Problems).
 * The work happens in main / the sidecar; the AI only proposes (suggestions the user accepts).
 */
import { create } from 'zustand'
import {
  LINE_SHEETS,
  PPE_TABLE,
  RECOMMEND_CANCELLED,
  SOCIE_TABLE,
  TEXT_BLOCKS_SCOPE,
  type CheckResult,
  type ConceptSuggestion,
  type GenerateXmlResult,
  type IndasDetails,
  type MasterFields,
  type PeriodRole,
  type RecommendRequest,
  type SheetTree,
  type Signatory,
  type StatementKey,
  type TransformResult,
  type TreeNode,
} from '@shared/indas'
import { validateNewFiling } from '@shared/project'
import type { CellRef, WorkbookModel } from '@shared/workbook'
import {
  applyTopSuggestions,
  autoTagRemaining,
  autoTagTodo,
  buildGenerateInput,
  checkRows,
  fromDraft,
  knownMasters,
  ppeFromTransform,
  prefillMasters,
  projectCompanyName,
  rowsFromTransform,
  socieFromTransform,
  suggestionKey,
  toDraft,
  withoutKnown,
  zeroRows,
  type PpeRow,
  type SocieRow,
  type TagRow,
  type TextBlockRow,
} from '@/features/indas/model'
import {
  canonicalWorkbook,
  elrOfConcept,
  emptyMandatory,
  explorerElrs,
  formLines,
  parseRowId,
  rowCells,
  rowIdAt,
  taggedOf,
  treeOf,
  TREE_SCOPES,
  type IndasElr,
  type ProblemTarget,
  type RowKind,
  type SheetEdit,
  withCellEdits,
} from '@/features/indas/workspace'
import { unwrap } from '@/lib/result'
import { toast } from './toast'
import { useProject } from './project'
import { useUi } from './ui'

export type SelectField = 'concept' | 'member'

interface IndasState {
  /** an Ind AS filing is open in the editor */
  open: boolean
  details: IndasDetails | null
  /** what is running ('Converting…'), null when idle; the editor is blocked meanwhile */
  busy: string | null
  /** the running work's current step, e.g. the sheet being auto-tagged */
  step: string | null
  progress: { done: number; total: number } | null
  transform: TransformResult | null
  /** the canonical sheets as the Excel pane shows them (same identity until the sheets change) */
  workbook: WorkbookModel | null
  rows: TagRow[]
  socie: SocieRow[]
  ppe: PpeRow[]
  texts: TextBlockRow[]
  fields: MasterFields | null
  company: Record<string, string>
  auditor: Record<string, string>
  signatories: Signatory[]
  result: GenerateXmlResult | null
  /** the taxonomy trees loaded so far, by "scope:kind" */
  trees: Record<string, SheetTree[]>
  /** the explorer entry open in the XBRL Form */
  activeElr: string | null
  /** the line (and which of its fields) being tagged */
  selection: { id: string; field: SelectField } | null
  /** a request for the Excel pane to show a cell; `seq` changes on every request */
  reveal: { cell: CellRef; seq: number } | null
  /** a request for the Form to scroll to a concept's row */
  focus: { concept: string; seq: number } | null
  /** the live Difference check per statement */
  checks: Partial<Record<StatementKey, CheckResult>>
  mastersOpen: boolean
  projectId: string
  savedPath: string | null
  /** when the project file was last written (ISO), and whether that was the auto-save */
  savedAt: { at: string; auto: boolean } | null
  dirty: boolean

  /** New project: validated and saved in main; returns the problems to show in the dialog ([] = created) */
  create(details: IndasDetails): Promise<string[]>
  openSaved(path: string): Promise<void>
  /** saves to the project's file; false when it failed. `auto`: the timed auto-save (no toast) */
  save(opts?: { auto?: boolean }): Promise<boolean>
  /** the auto-save tick: saves when there are unsaved changes and nothing is running */
  autosave(): Promise<void>
  /** saves unsaved work first; false when that failed (the filing stays open) */
  close(): Promise<boolean>
  /** Filing settings…: returns the problems ([] = applied) */
  updateDetails(details: IndasDetails): string[]

  loadTree(scope: string, kind: SelectField): Promise<void>
  loadExplorer(): Promise<void>
  elrs(): IndasElr[]
  setActiveElr(uri: string): void
  /** a cell clicked in the Excel pane selects its line (and shows its fact) */
  selectCell(cell: CellRef): void
  select(id: string, field?: SelectField): void
  /** shows a line's cell in the Excel pane */
  revealRow(id: string, which?: 'label' | 'cy' | 'py'): void
  /** the Excel pane shows another sheet: the XBRL Form follows it (a statement of that sheet) */
  showSheet(sheet: string): void
  /** cells edited in the Excel pane: the lines take the new amounts (tags kept) and the checks run again */
  editCells(edits: SheetEdit[]): void
  /** double-click in Problems: the line's cell and fact, the concept in the Form, or the dialog that fixes it */
  goToProblem(target: ProblemTarget): void

  tagFromTree(node: TreeNode): void
  rejectSuggestion(id: string, field?: SelectField): void
  setConcept(id: string, concept: string): void
  setMember(id: string, member: string): void
  setPeriodRole(id: string, role: PeriodRole): void
  /** Auto-tag: suggestions for every line that has none (all sheets, each from its own scope), then each untagged
   * line takes its top suggestion (PR #15 review, point 8). After a Cancel, running it again continues. */
  autoTag(): Promise<void>
  /** Cancel in the busy overlay: Auto-tag stops after the current batch and keeps what it got */
  cancelAutoTag(): void
  /** reports the open statement's empty mandatory amounts as 0 */
  fillMandatoryZeros(): void
  runCheck(): void

  addTextBlock(): void
  updateTextBlock(id: string, patch: Partial<Pick<TextBlockRow, 'heading' | 'content' | 'concept'>>): void
  removeTextBlock(id: string): void

  saveTemplate(): Promise<void>
  /** Open financial statements… (no path → file dialog) */
  upload(path?: string): Promise<void>

  loadFields(): Promise<void>
  setMastersOpen(open: boolean): void
  setCompany(qname: string, value: string): void
  setAuditor(qname: string, value: string): void
  addSignatory(): void
  updateSignatory(index: number, patch: Partial<Signatory>): void
  removeSignatory(index: number): void
  generate(): Promise<void>
  /** Generate's MCA checks again without blocking the editor (after accepted AI fixes); Problems shows the answer */
  revalidate(): Promise<void>
}

const api = () => window.xap.indas
const blankSignatory = (): Signatory => ({ din: '', name: '', designation: 'Director' })
let textSeq = 0
let seq = 0
let checkTimer: ReturnType<typeof setTimeout> | undefined
let savingAuto = false
/** the parts of the state the project file holds (toDraft) */
const SAVED_PARTS = ['rows', 'socie', 'ppe', 'texts', 'transform', 'company', 'auditor', 'signatories', 'details'] as const

const closed = () => ({
  open: false,
  details: null as IndasDetails | null,
  busy: null,
  step: null as string | null,
  progress: null,
  transform: null as TransformResult | null,
  workbook: null as WorkbookModel | null,
  rows: [] as TagRow[],
  socie: [] as SocieRow[],
  ppe: [] as PpeRow[],
  texts: [] as TextBlockRow[],
  company: {} as Record<string, string>,
  auditor: {} as Record<string, string>,
  signatories: [blankSignatory(), blankSignatory()],
  result: null as GenerateXmlResult | null,
  activeElr: null as string | null,
  selection: null as { id: string; field: SelectField } | null,
  reveal: null as { cell: CellRef; seq: number } | null,
  focus: null as { concept: string; seq: number } | null,
  checks: {} as Partial<Record<StatementKey, CheckResult>>,
  mastersOpen: false,
  projectId: '',
  savedPath: null as string | null,
  savedAt: null as { at: string; auto: boolean } | null,
  dirty: false,
})

/** The kind of a row (its statement for a line, else the table). */
const kindOfRow = (s: Pick<IndasState, 'rows'>, id: string): RowKind | null => {
  const r = s.rows.find((x) => x.id === id)
  return r ? r.statement : (parseRowId(id)?.kind ?? null)
}

export const useIndas = create<IndasState>((set, get) => {
  /** a change to the filing's work: marks it unsaved */
  const change = (patch: Partial<IndasState>) => set({ ...patch, dirty: true })

  /** One long job at a time; the editor is blocked (BusyOverlay) until it ends. */
  const run = async (label: string, fn: () => Promise<void>) => {
    if (get().busy) return
    set({ busy: label, step: null, progress: null })
    try {
      await fn()
    } finally {
      set({ busy: null, step: null, progress: null })
    }
  }

  /** Auto-tag's progress over every request of the run (`done` keys of `total`) and whether the user cancelled it. */
  const tally = { offset: 0, total: 0, cancelled: false }

  /** Asks for suggestions (with progress); null when the call failed (a toast says why) or was cancelled. */
  const recommend = async (req: RecommendRequest, step: string): Promise<ConceptSuggestion[][] | null> => {
    if (req.keys.length === 0) return []
    if (tally.cancelled) return null
    set({ step, progress: { done: tally.offset, total: tally.total } })
    const off = api().onProgress((p) => set({ progress: { done: tally.offset + p.done, total: tally.total } }))
    try {
      // a cancelled call is not an error: no toast
      let cancelled = false
      const found = await unwrap(api().recommend(req), { quietWhen: (e) => (cancelled = e.message === RECOMMEND_CANCELLED) })
      if (cancelled) tally.cancelled = true
      return found ?? null
    } finally {
      off()
      tally.offset += req.keys.length
    }
  }

  const todoLines = (statement: StatementKey) => autoTagTodo.lines(get().rows, statement)
  const todoSocie = () => autoTagTodo.socie(get().socie)
  const todoComponents = () => autoTagTodo.components(get().socie)
  const todoPpe = () => autoTagTodo.ppe(get().ppe)
  const todoTexts = () => autoTagTodo.texts(get().texts)

  const suggestLines = async (statement: StatementKey) => {
    const { sheet, title } = LINE_SHEETS.find((s) => s.key === statement)!
    const todo = todoLines(statement)
    const found = await recommend({ keys: todo.map(suggestionKey), contexts: todo.map((r) => r.breadcrumb), scope: sheet }, title)
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    change({ rows: get().rows.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
  }

  const suggestSocie = async () => {
    const todo = todoSocie()
    const concepts = await recommend({ keys: todo.map((r) => r.description), contexts: todo.map((r) => r.component), scope: SOCIE_TABLE.sheet }, 'Changes in equity')
    if (!concepts) return
    // members: one request per distinct equity component
    const components = todoComponents()
    const members = await recommend({ keys: components, scope: SOCIE_TABLE.sheet, kind: 'member' }, 'Changes in equity — components')
    const byComponent = new Map(components.map((c, i) => [c, members?.[i] ?? []]))
    const byId = new Map(todo.map((r, i) => [r.id, concepts[i] ?? []]))
    change({
      socie: get().socie.map((r) => ({
        ...r,
        suggestions: byId.get(r.id) ?? r.suggestions,
        memberSuggestions: r.memberSuggestions.length ? r.memberSuggestions : (byComponent.get(r.component) ?? []),
      })),
    })
  }

  const suggestPpe = async () => {
    const todo = todoPpe()
    const found = await recommend({ keys: todo.map((r) => r.assetClass), scope: PPE_TABLE.sheet, kind: 'member' }, 'Fixed assets — classes')
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    change({ ppe: get().ppe.map((r) => (byId.has(r.id) ? { ...r, memberSuggestions: byId.get(r.id)! } : r)) })
  }

  const suggestTexts = async () => {
    const todo = todoTexts()
    const found = await recommend({ keys: todo.map((r) => r.heading), scope: TEXT_BLOCKS_SCOPE }, 'Notes text blocks')
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    change({ texts: get().texts.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
  }

  /** Puts an opened / created project on screen. */
  const show = (projectId: string, path: string, draft: Record<string, unknown>) => {
    const work = fromDraft(draft)
    set({
      ...closed(),
      ...work,
      signatories: work.signatories.length ? work.signatories : [blankSignatory(), blankSignatory()],
      workbook: work.transform ? canonicalWorkbook(work.transform) : null,
      open: true,
      projectId,
      savedPath: path,
    })
    void get().loadExplorer()
    void get().loadFields()
    get().runCheck()
  }

  const activeEntry = (): IndasElr | undefined => get().elrs().find((e) => e.uri === get().activeElr)

  return {
    ...closed(),
    fields: null,
    trees: {},

    create: async (details) => {
      let problems: string[] = []
      const opened = await unwrap(api().create(details), { onValidation: (p) => (problems = p) })
      if (problems.length || !opened) return problems.length ? problems : ['The project could not be created.']
      if (!(await get().close())) return ['Save or close the open filing first.']
      show(opened.projectId, opened.path, opened.draft)
      toast.success(`Created ${opened.path}`)
      return []
    },

    openSaved: (path) =>
      run('Opening the project…', async () => {
        const opened = await unwrap(api().open(path))
        if (!opened) return
        if (!(await get().close())) return
        show(opened.projectId, opened.path, opened.draft)
        toast.success(`Opened ${projectCompanyName(get())}`)
      }),

    save: async (opts) => {
      const s = get()
      if (!s.open || !s.details) return false
      const saved = await unwrap(api().save({ projectId: s.projectId, path: s.savedPath, draft: toDraft({ ...s, details: s.details }), details: s.details }), { quiet: opts?.auto })
      if (!saved) return false
      // edits made while the file was being written stay unsaved
      const now = get()
      const unchanged = SAVED_PARTS.every((k) => now[k] === s[k])
      set({ savedPath: saved.path, savedAt: { at: saved.savedAt, auto: !!opts?.auto }, dirty: unchanged ? false : now.dirty })
      if (!opts?.auto) toast.success(`Saved ${saved.path}`)
      return true
    },

    autosave: async () => {
      const s = get()
      if (!s.open || !s.dirty || s.busy || savingAuto) return
      savingAuto = true
      try {
        await get().save({ auto: true })
      } finally {
        savingAuto = false
      }
    },

    close: async () => {
      if (!get().open) return true
      if (get().dirty && !(await get().save())) return false
      set({ ...closed() })
      return true
    },

    updateDetails: (details) => {
      const problems = validateNewFiling(details)
      if (problems.length) return problems
      const before = get().details
      const f = get().fields
      const known = knownMasters(details)
      const strip = (v: Record<string, string>) => withoutKnown(v, before ? knownMasters(before) : known)
      change({
        details,
        company: f ? prefillMasters(f.company, known, strip(get().company)) : get().company,
        auditor: f ? prefillMasters(f.auditor, known, strip(get().auditor)) : get().auditor,
      })
      return []
    },

    loadTree: async (scope, kind) => {
      const key = `${scope}:${kind}`
      if (get().trees[key]) return
      const trees = await unwrap(api().tree(scope, kind), { quiet: true })
      if (trees) set({ trees: { ...get().trees, [key]: trees } })
    },

    loadExplorer: async () => {
      await Promise.all(TREE_SCOPES.map((s) => get().loadTree(s.scope, 'concept')))
      // open on the first statement (the balance sheet) by group, never by code
      if (!get().activeElr) set({ activeElr: get().elrs().find((e) => e.group === 'Statements')?.uri ?? null })
    },

    elrs: () => explorerElrs(get().trees),

    setActiveElr: (uri) => {
      const entry = get().elrs().find((e) => e.uri === uri)
      if (entry?.kind === 'masters') return get().setMastersOpen(true)
      set({ activeElr: uri })
    },

    selectCell: (cell) => {
      const s = get()
      const ids = [...s.rows.map((r) => r.id), ...s.socie.map((r) => r.id), ...s.ppe.map((r) => r.id)]
      const id = rowIdAt(cell, ids)
      if (!id) return s.selection ? set({ selection: null }) : undefined
      const kind = kindOfRow(s, id)
      const field: SelectField = kind === 'ppe' ? 'member' : 'concept'
      // the same line again keeps its selection object (no re-render), but its fact is focused again below
      if (s.selection?.id !== id || s.selection.field !== field) set({ selection: { id, field } })
      if (!kind) return
      // its fact comes into view in the Form
      const concept = taggedOf(kind, s).find((r) => r.id === id)?.concept ?? ''
      const elr = elrOfConcept(s.elrs(), s.trees, kind, concept)
      if (elr && (concept || activeEntry()?.kind !== kind)) set({ activeElr: elr.uri })
      if (concept) set({ focus: { concept, seq: ++seq } })
    },

    select: (id, field = 'concept') => set({ selection: { id, field } }),

    revealRow: (id, which = 'cy') => {
      const t = get().transform
      const cells = t ? rowCells(t, id) : null
      const cell = cells?.[which] ?? cells?.label ?? null
      const kind = kindOfRow(get(), id)
      set({ selection: { id, field: kind === 'ppe' ? 'member' : 'concept' }, ...(cell ? { reveal: { cell, seq: ++seq } } : {}) })
    },

    editCells: (edits) => {
      const { transform, rows, socie, ppe } = get()
      if (!transform) return
      const next = withCellEdits({ transform, rows, socie, ppe }, edits)
      if (!next) return
      // the grid already shows the new values: `workbook` keeps its identity, so the grid is not rebuilt
      change(next)
      get().runCheck()
    },

    showSheet: (sheet) => {
      if (activeEntry()?.scope === sheet) return
      const first = get().elrs().find((e) => e.scope === sheet)
      if (first) set({ activeElr: first.uri })
    },

    goToProblem: (target) => {
      const s = get()
      useUi.getState().setRightTab('form')
      if (target.kind === 'masters') return s.setMastersOpen(true)
      if (target.kind === 'settings') return useProject.getState().openFilingSettings()
      if (target.kind === 'line') {
        const kind = kindOfRow(s, target.rowId)
        const concept = kind ? (taggedOf(kind, s).find((r) => r.id === target.rowId)?.concept ?? '') : ''
        // the statement first, so the sheet change the reveal causes keeps it (showSheet sees its own sheet)
        const elr = kind ? elrOfConcept(s.elrs(), s.trees, kind, concept) : null
        if (elr) set({ activeElr: elr.uri })
        if (concept) set({ focus: { concept, seq: ++seq } })
        return s.revealRow(target.rowId, target.which)
      }
      const holder = s.elrs().find((e) => (target.elr ? e.code === target.elr : treeOf(s.trees, e)?.nodes.some((n) => n.qname === target.concept)) && e.kind !== 'texts')
      if (holder) set({ activeElr: holder.uri })
      set({ focus: { concept: target.concept, seq: ++seq } })
    },

    tagFromTree: (node) => {
      const sel = get().selection
      if (!sel || node.abstract) return
      const qname = node.qname
      // the clicked node joins the row's candidates (label, period type), so the cell and Opening/Closing know it
      const asSuggestion: ConceptSuggestion = { qname, label: node.label, score: 0, type: node.type, periodType: node.periodType, balance: node.balance, pickedBy: null }
      const withNode = <T extends { id: string; suggestions?: ConceptSuggestion[]; memberSuggestions?: ConceptSuggestion[] }>(r: T): T => {
        if (r.id !== sel.id) return r
        const key = sel.field === 'member' ? 'memberSuggestions' : 'suggestions'
        const list = r[key] ?? []
        return list.some((x) => x.qname === qname) ? r : { ...r, [key]: [...list, asSuggestion] }
      }
      change({ rows: get().rows.map(withNode), socie: get().socie.map(withNode), ppe: get().ppe.map(withNode), texts: get().texts.map(withNode) })
      if (sel.field === 'member') get().setMember(sel.id, qname)
      else get().setConcept(sel.id, qname)
      // move on to the next untagged row of the same list, like webXBRL's keyboard flow
      const list = [...get().rows, ...get().socie, ...get().ppe, ...get().texts] as { id: string; concept?: string; member?: string }[]
      const i = list.findIndex((r) => r.id === sel.id)
      const prefix = sel.id.split(':')[0]
      const next = list.slice(i + 1).find((r) => r.id.split(':')[0] === prefix && !(sel.field === 'member' ? r.member : r.concept))
      if (next) {
        if (parseRowId(next.id)) get().revealRow(next.id, 'label')
        set({ selection: { id: next.id, field: sel.field } })
      }
    },

    rejectSuggestion: (id, field = 'concept') => {
      const drop = <T extends { id: string; suggestions?: ConceptSuggestion[]; memberSuggestions?: ConceptSuggestion[] }>(r: T): T =>
        r.id !== id ? r : field === 'member' ? { ...r, memberSuggestions: (r.memberSuggestions ?? []).slice(1) } : { ...r, suggestions: (r.suggestions ?? []).slice(1) }
      change({ rows: get().rows.map(drop), socie: get().socie.map(drop), ppe: get().ppe.map(drop), texts: get().texts.map(drop) })
    },

    setConcept: (id, concept) => {
      change({
        // an untagged zero line has no reason to stay
        rows: get().rows.flatMap((r) => (r.id !== id ? [r] : r.id.startsWith('zero:') && !concept ? [] : [{ ...r, concept }])),
        socie: get().socie.map((r) => (r.id === id ? { ...r, concept } : r)),
        texts: get().texts.map((r) => (r.id === id ? { ...r, concept } : r)),
      })
      get().runCheck()
    },
    setMember: (id, member) =>
      change({
        socie: get().socie.map((r) => (r.id === id ? { ...r, member } : r)),
        ppe: get().ppe.map((r) => (r.id === id ? { ...r, member } : r)),
      }),
    setPeriodRole: (id, periodRole) => {
      change({
        rows: get().rows.map((r) => (r.id === id ? { ...r, periodRole } : r)),
        socie: get().socie.map((r) => (r.id === id ? { ...r, periodRole } : r)),
      })
      get().runCheck()
    },

    autoTag: () =>
      run('Auto-tagging…', async () => {
        Object.assign(tally, { offset: 0, total: autoTagRemaining(get()), cancelled: false })
        for (const st of LINE_SHEETS) await suggestLines(st.key)
        await suggestSocie()
        await suggestPpe()
        await suggestTexts()
        // a cancelled run still applies what it got; the rest is asked for on Continue
        set({ step: 'Applying the tags…' })
        const { applied, ...tagged } = applyTopSuggestions(get())
        change(tagged)
        get().runCheck()
        const ai = get().rows.filter((r) => r.concept && r.suggestions[0]?.qname === r.concept && r.suggestions[0]?.pickedBy === 'ai').length
        const left = autoTagRemaining(get())
        const done = `tagged ${applied} line(s)${ai ? `, ${ai} picked by the AI (marked ✦, check them)` : ''}`
        if (tally.cancelled) toast.info(`Auto-tag cancelled: ${done}. ${left} line(s) left: Continue auto-tag does them.`)
        else toast.success(`Auto-tag ${done}. Change any tag in the Form or the inspector.`)
      }),

    cancelAutoTag: () => {
      if (get().busy !== 'Auto-tagging…' || tally.cancelled) return
      tally.cancelled = true
      set({ step: 'Cancelling — finishing the current batch…' })
      void api().cancelRecommend()
    },

    fillMandatoryZeros: () => {
      const s = get()
      const entry = activeEntry()
      const tree = treeOf(s.trees, entry)
      if (!entry || !tree || !LINE_SHEETS.some((l) => l.key === entry.kind)) return
      const kind = entry.kind as StatementKey
      const empty = emptyMandatory(formLines(tree, s.checks[kind]?.facts ?? {}, taggedOf(kind, s)))
      const added = zeroRows(kind, empty, s.rows)
      if (!added.length) return toast.info('No empty mandatory amounts in this statement.')
      change({ rows: [...s.rows, ...added] })
      get().runCheck()
      toast.success(`Reported ${added.length} empty mandatory amount(s) as 0.`)
    },

    runCheck: () => {
      clearTimeout(checkTimer)
      checkTimer = setTimeout(async () => {
        const rows = get().rows
        const results = await Promise.all(LINE_SHEETS.map((st) => unwrap(api().check(checkRows(rows, st.key)), { quiet: true })))
        if (get().rows !== rows) return // changed meanwhile: the next run brings the fresh result
        set({ checks: Object.fromEntries(LINE_SHEETS.flatMap((st, i) => (results[i] ? [[st.key, results[i]]] : []))) })
      }, 300)
    },

    addTextBlock: () => change({ texts: [...get().texts, { id: `text:${Date.now().toString(36)}${++textSeq}`, heading: '', content: '', suggestions: [], concept: '' }] }),
    updateTextBlock: (id, patch) =>
      change({
        texts: get().texts.map((r) => (r.id === id ? { ...r, ...patch, ...(patch.heading !== undefined && patch.heading !== r.heading ? { suggestions: [] } : {}) } : r)),
      }),
    removeTextBlock: (id) => change({ texts: get().texts.filter((r) => r.id !== id) }),

    saveTemplate: () =>
      run('Preparing the template…', async () => {
        const path = await unwrap(api().saveTemplate())
        if (path) toast.success(`Template saved: ${path}`)
      }),

    upload: (path) =>
      run('Converting the workbook…', async () => {
        if (get().transform && get().rows.some((r) => r.concept) && !window.confirm('Replace the financial statements? The tags of the current ones are dropped.')) return
        const t = await unwrap(api().transform(path))
        if (!t) return
        change({ transform: t, workbook: canonicalWorkbook(t), rows: rowsFromTransform(t), socie: socieFromTransform(t), ppe: ppeFromTransform(t), result: null, selection: null })
        get().runCheck()
        toast.success(t.source === 'standard_template' ? `Read ${t.fileName} (standard template)` : `Converted ${t.fileName}: review the rows`)
      }),

    loadFields: async () => {
      const fields = get().fields ?? (await unwrap(api().masterFields(), { quiet: true }))
      if (!fields) return
      const { details, company, auditor } = get()
      const known = details ? knownMasters(details) : {}
      set({ fields, company: prefillMasters(fields.company, known, company), auditor: prefillMasters(fields.auditor, known, auditor) })
    },
    setMastersOpen: (mastersOpen) => {
      set({ mastersOpen })
      if (mastersOpen) void get().loadFields()
    },
    setCompany: (q, v) => change({ company: { ...get().company, [q]: v } }),
    setAuditor: (q, v) => change({ auditor: { ...get().auditor, [q]: v } }),
    addSignatory: () => change({ signatories: [...get().signatories, blankSignatory()] }),
    updateSignatory: (i, patch) => change({ signatories: get().signatories.map((s, j) => (j === i ? { ...s, ...patch } : s)) }),
    removeSignatory: (i) => change({ signatories: get().signatories.filter((_, j) => j !== i) }),

    revalidate: async () => {
      const s = get()
      if (!s.open || !s.details || s.busy) return
      const before = s.result && !s.result.ok ? s.result.errors.length : null
      const result = await unwrap(api().generate(buildGenerateInput({ ...s, details: s.details })), { quiet: true })
      if (!result || get().projectId !== s.projectId) return
      set({ result })
      const was = before === null ? '' : ` (was ${before})`
      if (result.ok) toast.success(`MCA checks re-run: no problems${was}. XML saved: ${result.fileName}`)
      else toast.info(`MCA checks re-run: ${result.errors.length} problem(s)${was}. See Problems.`)
    },

    generate: () =>
      run('Validating and generating the XML…', async () => {
        const s = get()
        if (!s.details) return
        const result = await unwrap(api().generate(buildGenerateInput({ ...s, details: s.details })))
        if (!result) return
        set({ result })
        if (result.ok) {
          toast.success(`XML saved: ${result.fileName}`)
          useUi.getState().setRightTab('xml')
        } else {
          toast.error(`The MCA checks found ${result.errors.length} problem(s): see Problems.`)
          useUi.getState().setBottomTab('problems')
        }
      }),
  }
})
