/**
 * Renderer state of an open Ind AS filing (docs/17, ADR-0017): the canonical sheets, their tags, the masters and the
 * editor's selection. It feeds the same editor as a C&I filing (Filing Explorer, Excel pane, XBRL Form, Problems).
 * The work happens in main / the sidecar; the AI only proposes (suggestions the user accepts).
 */
import { create } from 'zustand'
import {
  LINE_SHEETS,
  PPE_TABLE,
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
  acceptTopMembers,
  acceptTopSuggestions,
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
  type RowKind,
} from '@/features/indas/workspace'
import { unwrap } from '@/lib/result'
import { toast } from './toast'
import { useUi } from './ui'

export type SelectField = 'concept' | 'member'

interface IndasState {
  /** an Ind AS filing is open in the editor */
  open: boolean
  details: IndasDetails | null
  /** what is running ('Converting…'), null when idle */
  busy: string | null
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
  dirty: boolean

  /** New project: validated and saved in main; returns the problems to show in the dialog ([] = created) */
  create(details: IndasDetails): Promise<string[]>
  openSaved(path: string): Promise<void>
  /** saves to the project's file; false when it failed */
  save(): Promise<boolean>
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

  tagFromTree(node: TreeNode): void
  rejectSuggestion(id: string, field?: SelectField): void
  setConcept(id: string, concept: string): void
  setMember(id: string, member: string): void
  setPeriodRole(id: string, role: PeriodRole): void
  /** Auto-tag: suggestions for every line that has none (all sheets, each from its own scope) */
  autoTag(): Promise<void>
  /** accepts the top suggestion on the untagged lines of the open statement */
  acceptTop(): void
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
}

const api = () => window.xap.indas
const blankSignatory = (): Signatory => ({ din: '', name: '', designation: 'Director' })
let textSeq = 0
let seq = 0
let checkTimer: ReturnType<typeof setTimeout> | undefined

const closed = () => ({
  open: false,
  details: null as IndasDetails | null,
  busy: null,
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

  const run = async (label: string, fn: () => Promise<void>) => {
    if (get().busy) return
    set({ busy: label })
    try {
      await fn()
    } finally {
      set({ busy: null, progress: null })
    }
  }

  /** Asks for suggestions (with progress); null when the call failed (a toast says why). */
  const recommend = async (req: RecommendRequest): Promise<ConceptSuggestion[][] | null> => {
    if (req.keys.length === 0) return []
    const off = api().onProgress((p) => set({ progress: p }))
    try {
      return (await unwrap(api().recommend(req))) ?? null
    } finally {
      off()
    }
  }

  const suggestLines = async (statement: StatementKey) => {
    const sheet = LINE_SHEETS.find((s) => s.key === statement)!.sheet
    const todo = get().rows.filter((r) => r.statement === statement && r.suggestions.length === 0 && !r.id.startsWith('zero:'))
    const found = await recommend({ keys: todo.map(suggestionKey), contexts: todo.map((r) => r.breadcrumb), scope: sheet })
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    change({ rows: get().rows.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
  }

  const suggestSocie = async () => {
    const todo = get().socie.filter((r) => r.suggestions.length === 0)
    const concepts = await recommend({ keys: todo.map((r) => r.description), contexts: todo.map((r) => r.component), scope: SOCIE_TABLE.sheet })
    if (!concepts) return
    // members: one request per distinct equity component
    const components = [...new Set(get().socie.filter((r) => r.memberSuggestions.length === 0).map((r) => r.component).filter(Boolean))]
    const members = await recommend({ keys: components, scope: SOCIE_TABLE.sheet, kind: 'member' })
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
    const todo = get().ppe.filter((r) => r.memberSuggestions.length === 0)
    const found = await recommend({ keys: todo.map((r) => r.assetClass), scope: PPE_TABLE.sheet, kind: 'member' })
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    change({ ppe: get().ppe.map((r) => (byId.has(r.id) ? { ...r, memberSuggestions: byId.get(r.id)! } : r)) })
  }

  const suggestTexts = async () => {
    const todo = get().texts.filter((r) => r.heading.trim() && r.suggestions.length === 0)
    const found = await recommend({ keys: todo.map((r) => r.heading), scope: TEXT_BLOCKS_SCOPE })
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

    save: async () => {
      const s = get()
      if (!s.open || !s.details) return false
      const saved = await unwrap(api().save({ projectId: s.projectId, path: s.savedPath, draft: toDraft({ ...s, details: s.details }), details: s.details }))
      if (!saved) return false
      set({ savedPath: saved.path, dirty: false })
      toast.success(`Saved ${saved.path}`)
      return true
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
        for (const st of LINE_SHEETS) await suggestLines(st.key)
        await suggestSocie()
        await suggestPpe()
        await suggestTexts()
        const open = get().rows.filter((r) => !r.concept && r.suggestions.length).length
        toast.success(`Suggestions ready: ${open} line(s) to review. Nothing is tagged until you accept.`)
      }),

    acceptTop: () => {
      const kind = activeEntry()?.kind
      if (!kind || kind === 'masters') return
      if (kind === 'socie') change({ socie: acceptTopMembers(acceptTopSuggestions(get().socie)) })
      else if (kind === 'ppe') change({ ppe: acceptTopMembers(get().ppe) })
      else if (kind === 'texts') change({ texts: acceptTopSuggestions(get().texts) })
      else {
        const accepted = new Map(acceptTopSuggestions(get().rows.filter((r) => r.statement === kind)).map((r) => [r.id, r]))
        change({ rows: get().rows.map((r) => accepted.get(r.id) ?? r) })
      }
      get().runCheck()
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
