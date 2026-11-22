/**
 * IndasProjectService: creates, saves and reopens Ind AS projects in the projects folder (docs/17: "save projects
 * there"). Electron-free: the file store, the folder, the clock and the id source are ports.
 *
 * A new project is written straight away as `<Company>_<FY>.axbrl`, so it is listed on the start screen before any
 * workbook is attached. Its filing settings (company, CIN, nature, periods, rounding) live in the draft's `details`
 * and in the manifest; the renderer owns the rest of the draft.
 */
import { join } from 'node:path'
import { fyLabel } from '@xap/engine/basics'
import type { IndasDetails, IndasOpened, IndasSaved, IndasSaveRequest } from '@shared/indas'
import { validateNewFiling } from '@shared/project'
import { AXBRL_EXTENSION, type AxbrlManifest } from '../project/axbrl'
import { INDAS_DRAFT_VERSION, indasManifest, type IndasFile } from '../project/indas-file'
import { ValidationError } from './errors'

export interface IndasProjectStore {
  write(path: string, f: IndasFile): Promise<void>
  read(path: string): Promise<IndasFile>
  /** the manifest of an existing project file; null when there is none (or it isn't one) */
  manifestOf(path: string): Promise<AxbrlManifest | null>
}

export const INDAS_TAXONOMY = 'ind-as-2017'

export class IndasProjectService {
  constructor(
    private readonly store: IndasProjectStore,
    private readonly projectsDir: () => string,
    private readonly appVersion: string,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  /** New project: validates the settings, saves an empty project in the projects folder and returns it opened. */
  async create(input: IndasDetails): Promise<IndasOpened> {
    const details = normalised(input)
    const problems = validateNewFiling(details)
    if (details.taxonomy !== INDAS_TAXONOMY) problems.push('This project type is for Ind AS 2017 filings.')
    if (problems.length) throw new ValidationError(problems)
    const projectId = this.newId()
    const draft = { version: INDAS_DRAFT_VERSION, details }
    const saved = await this.save({ projectId, path: null, draft, details })
    return { path: saved.path, projectId, draft }
  }

  /** Saves to `req.path`, or to a new file in the projects folder named after the company and year. */
  async save(req: IndasSaveRequest): Promise<IndasSaved> {
    const path = req.path ?? (await this.freePath(req))
    const existing = await this.store.manifestOf(path)
    if (existing && existing.projectId !== req.projectId) throw new Error(`${path} belongs to another project`)
    const savedAt = this.now().toISOString()
    const manifest = indasManifest({
      projectId: req.projectId,
      appVersion: this.appVersion,
      createdAt: existing?.createdAt ?? savedAt,
      updatedAt: savedAt,
      details: req.details,
    })
    await this.store.write(path, { manifest, draft: { ...req.draft, version: INDAS_DRAFT_VERSION } })
    return { path, savedAt }
  }

  async open(path: string): Promise<IndasOpened> {
    const f = await this.store.read(path)
    return { path, projectId: f.manifest.projectId, draft: f.draft }
  }

  /** What a project file is (File → Open routes Ind AS and engine filings to their own editors). */
  async kindOf(path: string): Promise<'indas' | 'filing'> {
    const m = await this.store.manifestOf(path)
    if (!m) throw new Error('Not an XBRL Autopilot project file')
    return m.kind === 'indas' ? 'indas' : 'filing'
  }

  /** `<Company>_<FY>.axbrl`; ` (2)`, ` (3)` … when another project already has that name. */
  private async freePath(req: IndasSaveRequest): Promise<string> {
    const base = indasFileStem(req.details.companyName, req.details.cy)
    for (let n = 1; ; n++) {
      const path = join(this.projectsDir(), `${base}${n > 1 ? ` (${n})` : ''}${AXBRL_EXTENSION}`)
      const m = await this.store.manifestOf(path)
      if (!m || m.projectId === req.projectId) return path
    }
  }
}

/** Trimmed text, an upper-case CIN, Ind AS by default (the dialog's default too). */
function normalised(input: IndasDetails): IndasDetails {
  return { ...input, taxonomy: input.taxonomy ?? INDAS_TAXONOMY, companyName: (input.companyName ?? '').trim(), cin: (input.cin ?? '').trim().toUpperCase() }
}

/** `<Company>_FY 2025-26`, safe on Windows. */
export function indasFileStem(company: string, cy: { start: string; end: string }): string {
  const safe = company.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled company'
  const fy = /^\d{4}/.test(cy.start) && /^\d{4}/.test(cy.end) ? fyLabel(cy) : 'FY'
  return `${safe}_${fy}`
}
