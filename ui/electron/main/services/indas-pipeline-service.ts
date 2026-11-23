/**
 * IndasPipelineService: Vashu's Ind AS pipeline (docs/17) over the sidecar's /api/v1/indas/* routes.
 * Excel → canonical sheets (/transform) → tag suggestions (/recommend) → masters → XML (/generateXML).
 * The master fields and the live Difference check are computed here from the knowledge base (/authority, read
 * once per session), so editing a cell never calls the sidecar (PR #15 review).
 * Electron-free: the sidecar, the output folder and the writer come in as ports. The AI only proposes tags;
 * the renderer sends the tags the user accepted.
 */
import type {
  CanonicalRow,
  ConceptSuggestion,
  GenerateXmlInput,
  GenerateXmlProblem,
  GenerateXmlResult,
  MasterFields,
  RecommendRequest,
  SheetTree,
  CheckResult,
  FixProposal,
  FixRequest,
  StatementLine,
  TransformResult,
} from '@shared/indas'
import { FIX_STOPPED, LINE_SHEETS, RECOMMEND_CANCELLED } from '@shared/indas'
import { sidecarCall } from '../infra/sidecar-call'
import { deriveFiling, deriveTotals } from './indas-derived-totals'
import { checkDifferences } from './indas-difference-check'
import { dryRun, type ProposedChange } from './indas-fix-dry-run'
import type { IndasKnowledgeBase } from './indas-knowledge-base'
import { masterFieldsOf } from './indas-master-fields'
import type { OutputWriter } from './mca-tool-service'
import type { SidecarClient, SidecarFileClient } from './ports'

const BASE = '/api/v1/indas'
/** Keys per /recommend call: small enough to show progress and stay under the request timeout. */
export const RECOMMEND_BATCH = 20
const SLOW_MS = 300_000

interface Envelope<T> {
  data: T
  success: boolean
  message: string
  errors?: { message?: string; type?: string | null; concept?: string | null; member?: string | null }[] | null
}

interface RawMatch {
  metadata?: Record<string, unknown>
  page_content?: string
}

export class IndasPipelineService {
  private kb: Promise<IndasKnowledgeBase> | null = null

  constructor(
    private readonly sidecar: SidecarClient & SidecarFileClient,
    private readonly output: OutputWriter,
    /** the user's AI consent (Settings): only then does the AI pick among the candidates */
    private readonly aiAllowed: () => boolean = () => false,
  ) {}

  /** The standard template workbook (.xlsx bytes) — input path 1. */
  async template(): Promise<Uint8Array> {
    await this.sidecar.whenReady(120_000)
    const res = await this.sidecar.download(`${BASE}/template`)
    if (res.status !== 200) throw new Error(`Could not get the template (${res.status})`)
    return res.bytes
  }

  /** Converts a client workbook (or reads a filled template) into the six canonical sheets. */
  async transform(fileName: string, bytes: Uint8Array): Promise<TransformResult> {
    await this.sidecar.whenReady(120_000)
    const res = await this.sidecar.upload<Envelope<{ summary?: Record<string, unknown>; sheets?: Record<string, CanonicalRow[]> }>>(
      `${BASE}/transform`,
      { field: 'file', fileName, bytes },
      SLOW_MS,
    )
    if (res.status !== 200 || !res.data?.success) throw new Error(res.data?.message || `Transformation failed (${res.status})`)
    const summary = res.data.data.summary ?? {}
    return { fileName, source: String(summary.source ?? 'heuristic'), sheets: res.data.data.sheets ?? {}, summary }
  }

  /**
   * Tag suggestions for each key, in key order (an empty list when nothing matched), from the request's sheet
   * scope only (docs/15 §3). The AI picks among the candidates only when the user allowed AI (Settings).
   * `onProgress(done, total)` after each batch.
   */
  async recommend(req: RecommendRequest, topK = 3, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<ConceptSuggestion[][]> {
    const { keys } = req
    const out: ConceptSuggestion[][] = []
    for (let i = 0; i < keys.length; i += RECOMMEND_BATCH) {
      // Cancel (the busy overlay) stops between batches: the batch the backend is ranking finishes first
      if (signal?.aborted) throw new RecommendCancelled()
      const batch = keys.slice(i, i + RECOMMEND_BATCH)
      const data = await sidecarCall<RawMatch[][]>(this.sidecar, 'POST', `${BASE}/recommend/`, {
        body: {
          keys: batch,
          contexts: req.contexts?.slice(i, i + RECOMMEND_BATCH),
          scope: req.scope,
          kind: req.kind ?? 'concept',
          top_k: topK,
          use_llm: this.aiAllowed(),
        },
        timeoutMs: SLOW_MS,
        what: 'Tag suggestions',
      })
      for (let j = 0; j < batch.length; j++) out.push((data[j] ?? []).map(toSuggestion).filter((s): s is ConceptSuggestion => s !== null))
      onProgress?.(out.length, keys.length)
    }
    return out
  }

  /** The split view's right pane: a sheet's ELR trees, or its table axis members. */
  tree(scope: string, kind: 'concept' | 'member' = 'concept'): Promise<SheetTree[]> {
    return sidecarCall<SheetTree[]>(this.sidecar, 'GET', `${BASE}/tree/${encodeURIComponent(scope)}?kind=${kind}`, { what: 'Taxonomy tree' })
  }

  /**
   * The live Difference bar of one statement: totals vs their tagged children, balance sheet balance (exact decimals,
   * no sidecar call). `elrs` = the statement's ELR codes: the totals its lines imply are derived from their
   * calculations first (issue #20, point 5), so the Form shows them and the totals above them can be compared.
   */
  async check(rows: StatementLine[], elrs: readonly string[] = []): Promise<CheckResult> {
    const kb = await this.knowledgeBase()
    return checkDifferences(kb, rows, new Set(), deriveTotals(kb, rows, elrs))
  }

  /**
   * Fix with AI (Problems panel): the backend's AI proposes tag changes for the totals that don't add up, and each
   * one is dry-run here on the whole filing (`req.filing`; only `req.lines` go to the backend). Needs the user's AI
   * consent (Settings): amounts go to the AI, never the company name, CIN or DINs (the request has no field for
   * them). Nothing is applied here.
   */
  async proposeFix(req: FixRequest, signal?: AbortSignal): Promise<FixProposal> {
    if (!this.aiAllowed()) throw new Error('Fix with AI sends line items and amounts to the AI: allow AI in Settings first.')
    const sheetOf = new Map<string, string>(LINE_SHEETS.map((s) => [s.key, s.sheet]))
    const ask = sidecarCall<{ explanation: string; changes: ProposedChange[] }>(this.sidecar, 'POST', `${BASE}/fix`, {
      body: { problems: req.problems, lines: req.lines.map((l) => ({ ...l, sheet: sheetOf.get(l.statement) ?? l.statement })) },
      timeoutMs: SLOW_MS,
      what: 'Fix with AI',
      signal,
    })
    // Stop (the AI chat): the request is aborted and the answer, if any, is never used
    const [kb, answer] = await Promise.all([this.knowledgeBase(), ask]).catch((e: unknown) => {
      throw signal?.aborted ? new Error(FIX_STOPPED) : e
    })
    if (signal?.aborted) throw new Error(FIX_STOPPED)
    return { explanation: answer.explanation, changes: dryRun(kb, req.filing?.length ? req.filing : req.lines, answer.changes ?? [], req.elrs) }
  }

  /** The mandatory company and auditor fields for the masters form. */
  async masterFields(): Promise<MasterFields> {
    return masterFieldsOf(await this.knowledgeBase())
  }

  /** The Ind AS knowledge base, fetched once; a failed fetch is retried on the next call. */
  private knowledgeBase(): Promise<IndasKnowledgeBase> {
    this.kb ??= sidecarCall<IndasKnowledgeBase>(this.sidecar, 'GET', `${BASE}/authority`, { timeoutMs: SLOW_MS, what: 'Knowledge base' }).catch((e) => {
      this.kb = null
      throw e
    })
    return this.kb
  }

  /**
   * Validates and generates the XML; on success it is written to the projects folder. The totals the lines imply
   * (`input.elrs`, derived as the live check derives them) are filed too, although no line reports them.
   */
  async generate(input: GenerateXmlInput): Promise<GenerateXmlResult> {
    await this.sidecar.whenReady(120_000)
    const full = input.elrs ? { ...input, statements: deriveFiling(await this.knowledgeBase(), input.statements, input.elrs).lines } : input
    const res = await this.sidecar.request<Envelope<{ xmlContent?: string; fileSizeKb?: number }>>('POST', `${BASE}/generateXML`, toPayload(full), SLOW_MS)
    if (res.status === 200 && res.data?.success && typeof res.data.data?.xmlContent === 'string') {
      const fileName = xmlFileName(input.companyName, input.meta.endDate)
      const path = await this.output.write(null, fileName, res.data.data.xmlContent)
      return { ok: true, path, fileName, sizeKb: res.data.data.fileSizeKb ?? 0, xml: res.data.data.xmlContent }
    }
    const errors: GenerateXmlProblem[] = (res.data?.errors ?? []).map((e) => ({
      type: e.type ?? null,
      message: e.message ?? String(e),
      ...(e.concept ? { concept: e.concept } : {}),
      ...(e.member ? { member: e.member } : {}),
    }))
    if (errors.length === 0) errors.push({ type: null, message: res.data?.message || `XML generation failed (${res.status})` })
    return { ok: false, errors }
  }
}

/** Auto-tag was cancelled by the user (not a failure: the renderer keeps what it got and can continue). */
export class RecommendCancelled extends Error {
  constructor() {
    super(RECOMMEND_CANCELLED)
    this.name = 'RecommendCancelled'
  }
}

function toSuggestion(m: RawMatch): ConceptSuggestion | null {
  const md = m.metadata ?? {}
  const qname = typeof md.qname === 'string' ? md.qname : null
  if (!qname) return null
  const labels = md.labels as { label?: string } | undefined
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    qname,
    label: labels?.label ?? str(md.name) ?? qname,
    score: typeof md.relevance_score === 'number' ? md.relevance_score : 0,
    type: str(md.type),
    periodType: str(md.periodType),
    balance: str(md.balance),
    pickedBy: md.pickedBy === 'ai' ? 'ai' : null,
  }
}

/** The /generateXML request body (api/v1/schemas/indas_schema.py → GenerateXML). */
export function toPayload(input: GenerateXmlInput) {
  const lines = (rows: StatementLine[] = []) =>
    rows.filter((r) => r.concept).map((r) => ({ concept: r.concept, cy: r.cy, py: r.py, ...(r.periodRole === 'start' ? { periodRole: 'start' } : {}) }))
  const filled = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''))
  return {
    meta: { taxonomy: 'ind_as', nature: input.meta.nature, startDate: input.meta.startDate, endDate: input.meta.endDate, unit: 'INR', decimals: '0' },
    master: {
      company: filled(input.master.company),
      auditor: filled(input.master.auditor),
      signatories: input.master.signatories.map((s) => ({
        din: s.din.trim(),
        name: s.name.trim() || undefined,
        designation: s.designation.trim() || 'Director',
        signingDate: s.signingDate || undefined,
      })),
    },
    statements: Object.fromEntries(LINE_SHEETS.map((s) => [s.key, lines(input.statements[s.key])])),
    tables: input.tables.filter((t) => t.rows.length > 0),
    notes: input.notes.filter((n) => n.concept && n.content.trim()).map((n) => ({ concept: n.concept, content: n.content })),
  }
}

/** `<Company>_AOC4_<end date>.xml`, safe on Windows. */
export function xmlFileName(company: string, endDate: string): string {
  const safe = company.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Filing'
  return `${safe}_AOC4_${endDate || 'FY'}.xml`
}
