/** Renderer state of the Ind AS pipeline screen (docs/17). The work happens in main / the sidecar. */
import { create } from 'zustand'
import {
  LINE_SHEETS,
  PPE_TABLE,
  SOCIE_TABLE,
  TEXT_BLOCKS_SCOPE,
  type ConceptSuggestion,
  type GenerateXmlResult,
  type MasterFields,
  type PeriodRole,
  type RecommendRequest,
  type Signatory,
  type StatementKey,
  type TransformResult,
} from '@shared/indas'
import {
  acceptTopMembers,
  acceptTopSuggestions,
  buildGenerateInput,
  fromDraft,
  ppeFromTransform,
  projectCompanyName,
  toDraft,
  prefillMasters,
  rowsFromTransform,
  socieFromTransform,
  suggestionKey,
  type FilingMeta,
  type PpeRow,
  type SocieRow,
  type TagRow,
  type TextBlockRow,
} from '@/features/indas/model'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

export type IndasStep = 'financials' | 'tagging' | 'masters' | 'generate'
/** One tagging tab per canonical sheet (docs/15 §5) plus the notes' text blocks. */
export type TagTab = StatementKey | 'socie' | 'ppe' | 'texts'

interface IndasState {
  open: boolean
  step: IndasStep
  tab: TagTab
  /** what is running ('Converting…'), null when idle */
  busy: string | null
  progress: { done: number; total: number } | null
  transform: TransformResult | null
  rows: TagRow[]
  socie: SocieRow[]
  ppe: PpeRow[]
  texts: TextBlockRow[]
  fields: MasterFields | null
  meta: FilingMeta
  company: Record<string, string>
  auditor: Record<string, string>
  signatories: Signatory[]
  result: GenerateXmlResult | null
  /** the project this work is saved as */
  projectId: string
  savedPath: string | null
  savedAt: string | null

  openPipeline(): void
  /** reopens a saved Ind AS project (start screen → Saved projects) */
  openSaved(path: string): Promise<void>
  /** saves to the projects folder (a new file the first time); false when it failed */
  save(): Promise<boolean>
  closePipeline(): Promise<void>
  setStep(step: IndasStep): void
  setTab(tab: TagTab): void
  saveTemplate(): Promise<void>
  /** no path → file dialog */
  upload(path?: string): Promise<void>
  /** suggestions for the lines of a tab that have none yet (the active tab when omitted) */
  suggest(tab?: TagTab): Promise<void>
  acceptTop(tab?: TagTab): void
  setConcept(id: string, concept: string): void
  setMember(id: string, member: string): void
  setPeriodRole(id: string, role: PeriodRole): void
  addTextBlock(): void
  updateTextBlock(id: string, patch: Partial<Pick<TextBlockRow, 'heading' | 'content' | 'concept'>>): void
  removeTextBlock(id: string): void
  loadFields(): Promise<void>
  setMeta(patch: Partial<FilingMeta>): void
  setCompany(qname: string, value: string): void
  setAuditor(qname: string, value: string): void
  addSignatory(): void
  updateSignatory(index: number, patch: Partial<Signatory>): void
  removeSignatory(index: number): void
  generate(): Promise<void>
}

const api = () => window.xap.indas
const thisFy = (): FilingMeta => {
  const now = new Date()
  const endYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { nature: 'Standalone', startDate: `${endYear - 1}-04-01`, endDate: `${endYear}-03-31` }
}
const blankSignatory = (): Signatory => ({ din: '', name: '', designation: 'Director' })
let textSeq = 0

const initial = () => ({
  step: 'financials' as IndasStep,
  tab: 'balanceSheet' as TagTab,
  busy: null,
  progress: null,
  transform: null,
  rows: [],
  socie: [],
  ppe: [],
  texts: [],
  meta: thisFy(),
  company: {},
  auditor: {},
  signatories: [blankSignatory(), blankSignatory()],
  result: null,
  projectId: newProjectId(),
  savedPath: null as string | null,
  savedAt: null as string | null,
})

function newProjectId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const isLineTab = (tab: TagTab): tab is StatementKey => LINE_SHEETS.some((s) => s.key === tab)

export const useIndas = create<IndasState>((set, get) => {
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

  const suggestLines = async (tab: StatementKey) => {
    const sheet = LINE_SHEETS.find((s) => s.key === tab)!.sheet
    const todo = get().rows.filter((r) => r.statement === tab && r.suggestions.length === 0)
    const found = await recommend({ keys: todo.map(suggestionKey), contexts: todo.map((r) => r.breadcrumb), scope: sheet })
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    set({ rows: get().rows.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
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
    set({
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
    set({ ppe: get().ppe.map((r) => (byId.has(r.id) ? { ...r, memberSuggestions: byId.get(r.id)! } : r)) })
  }

  const suggestTexts = async () => {
    const todo = get().texts.filter((r) => r.heading.trim() && r.suggestions.length === 0)
    const found = await recommend({ keys: todo.map((r) => r.heading), scope: TEXT_BLOCKS_SCOPE })
    if (!found) return
    const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
    set({ texts: get().texts.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
  }

  return {
    open: false,
    fields: null,
    ...initial(),

    openPipeline: () => set({ open: true }),
    // leaving keeps the work: it is saved first (when there is any)
    closePipeline: async () => {
      if (get().transform && !(await get().save())) return
      set({ open: false, ...initial() })
    },

    openSaved: (path) =>
      run('Opening the project…', async () => {
        const opened = await unwrap(api().open(path))
        if (!opened) return
        const work = fromDraft(opened.draft)
        set({ ...initial(), ...work, open: true, step: work.transform ? 'tagging' : 'financials', projectId: opened.projectId, savedPath: opened.path, savedAt: null })
        toast.success(`Opened ${projectCompanyName(work)}`)
      }),

    save: async () => {
      const s = get()
      const saved = await unwrap(
        api().save({
          projectId: s.projectId,
          path: s.savedPath,
          draft: toDraft(s),
          company: { name: projectCompanyName(s), cin: Object.entries(s.company).find(([k]) => k.endsWith(':CorporateIdentityNumber'))?.[1] ?? '' },
          nature: s.meta.nature,
          cy: { start: s.meta.startDate, end: s.meta.endDate },
        }),
      )
      if (!saved) return false
      set({ savedPath: saved.path, savedAt: saved.savedAt })
      toast.success(`Saved ${saved.path}`)
      return true
    },
    setStep: (step) => {
      set({ step })
      if (step === 'masters') void get().loadFields()
    },
    setTab: (tab) => set({ tab }),

    saveTemplate: () =>
      run('Preparing the template…', async () => {
        const path = await unwrap(api().saveTemplate())
        if (path) toast.success(`Template saved: ${path}`)
      }),

    upload: (path) =>
      run('Converting the workbook…', async () => {
        const t = await unwrap(api().transform(path))
        if (!t) return
        set({ transform: t, rows: rowsFromTransform(t), socie: socieFromTransform(t), ppe: ppeFromTransform(t), result: null })
        toast.success(t.source === 'standard_template' ? `Read ${t.fileName} (standard template)` : `Converted ${t.fileName}: review the rows`)
      }),

    suggest: (tab) =>
      run('Suggesting tags…', async () => {
        const t = tab ?? get().tab
        if (isLineTab(t)) await suggestLines(t)
        else if (t === 'socie') await suggestSocie()
        else if (t === 'ppe') await suggestPpe()
        else await suggestTexts()
      }),

    acceptTop: (tab) => {
      const t = tab ?? get().tab
      if (isLineTab(t)) {
        const mine = get().rows.filter((r) => r.statement === t)
        const accepted = new Map(acceptTopSuggestions(mine).map((r) => [r.id, r]))
        set({ rows: get().rows.map((r) => accepted.get(r.id) ?? r) })
      } else if (t === 'socie') set({ socie: acceptTopMembers(acceptTopSuggestions(get().socie)) })
      else if (t === 'ppe') set({ ppe: acceptTopMembers(get().ppe) })
      else set({ texts: acceptTopSuggestions(get().texts) })
    },

    setConcept: (id, concept) =>
      set({
        rows: get().rows.map((r) => (r.id === id ? { ...r, concept } : r)),
        socie: get().socie.map((r) => (r.id === id ? { ...r, concept } : r)),
        texts: get().texts.map((r) => (r.id === id ? { ...r, concept } : r)),
      }),
    setMember: (id, member) =>
      set({
        socie: get().socie.map((r) => (r.id === id ? { ...r, member } : r)),
        ppe: get().ppe.map((r) => (r.id === id ? { ...r, member } : r)),
      }),
    setPeriodRole: (id, periodRole) =>
      set({
        rows: get().rows.map((r) => (r.id === id ? { ...r, periodRole } : r)),
        socie: get().socie.map((r) => (r.id === id ? { ...r, periodRole } : r)),
      }),

    addTextBlock: () => set({ texts: [...get().texts, { id: `text:${++textSeq}`, heading: '', content: '', suggestions: [], concept: '' }] }),
    updateTextBlock: (id, patch) =>
      set({
        texts: get().texts.map((r) => (r.id === id ? { ...r, ...patch, ...(patch.heading !== undefined && patch.heading !== r.heading ? { suggestions: [] } : {}) } : r)),
      }),
    removeTextBlock: (id) => set({ texts: get().texts.filter((r) => r.id !== id) }),

    loadFields: async () => {
      const fields = get().fields ?? (await unwrap(api().masterFields()))
      if (!fields) return
      const { meta, company, auditor } = get()
      set({ fields, company: prefillMasters(fields.company, meta, company), auditor: prefillMasters(fields.auditor, meta, auditor) })
    },

    setMeta: (patch) => {
      const meta = { ...get().meta, ...patch }
      const f = get().fields
      // the period / nature fields follow the filing settings
      set({ meta, company: f ? prefillMasters(f.company, meta, dropKnown(get().company)) : get().company })
    },
    setCompany: (q, v) => set({ company: { ...get().company, [q]: v } }),
    setAuditor: (q, v) => set({ auditor: { ...get().auditor, [q]: v } }),
    addSignatory: () => set({ signatories: [...get().signatories, blankSignatory()] }),
    updateSignatory: (i, patch) => set({ signatories: get().signatories.map((s, j) => (j === i ? { ...s, ...patch } : s)) }),
    removeSignatory: (i) => set({ signatories: get().signatories.filter((_, j) => j !== i) }),

    generate: () =>
      run('Validating and generating the XML…', async () => {
        const result = await unwrap(api().generate(buildGenerateInput(get())))
        if (!result) return
        set({ result })
        if (result.ok) toast.success(`XML saved: ${result.fileName}`)
      }),
  }
})

/** Removes the values prefillMasters owns, so they are recomputed from the new filing settings. */
function dropKnown(company: Record<string, string>): Record<string, string> {
  const owned = /:(DateOfStartOfReportingPeriod|DateOfEndOfReportingPeriod|NatureOfReportStandaloneConsolidated)$/
  return Object.fromEntries(Object.entries(company).filter(([k]) => !owned.test(k)))
}
