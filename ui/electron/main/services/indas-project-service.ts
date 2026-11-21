/**
 * IndasProjectService: saves and reopens the Ind AS pipeline's work as a project in the projects folder
 * (docs/17: "save projects there"). Electron-free: the file store, the folder and the clock are ports.
 */
import { join } from 'node:path'
import type { IndasOpened, IndasSaved, IndasSaveRequest } from '@shared/indas'
import { AXBRL_EXTENSION, type AxbrlManifest } from '../project/axbrl'
import { INDAS_DRAFT_VERSION, indasManifest, type IndasFile } from '../project/indas-file'

export interface IndasProjectStore {
  write(path: string, f: IndasFile): Promise<void>
  read(path: string): Promise<IndasFile>
  /** the manifest of an existing project file; null when there is none (or it isn't one) */
  manifestOf(path: string): Promise<AxbrlManifest | null>
}

export class IndasProjectService {
  constructor(
    private readonly store: IndasProjectStore,
    private readonly projectsDir: () => string,
    private readonly appVersion: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
      company: { name: req.company.name.trim(), cin: req.company.cin.trim() },
      nature: req.nature,
      cy: req.cy,
    })
    await this.store.write(path, { manifest, draft: { ...req.draft, version: INDAS_DRAFT_VERSION } })
    return { path, savedAt }
  }

  async open(path: string): Promise<IndasOpened> {
    const f = await this.store.read(path)
    return { path, projectId: f.manifest.projectId, draft: f.draft }
  }

  /** `<Company>_Ind AS_FY <yyyy-yy>.axbrl`; ` (2)`, ` (3)` … when another project already has that name. */
  private async freePath(req: IndasSaveRequest): Promise<string> {
    const base = `${indasFileStem(req.company.name, req.cy)}`
    for (let n = 1; ; n++) {
      const path = join(this.projectsDir(), `${base}${n > 1 ? ` (${n})` : ''}${AXBRL_EXTENSION}`)
      const m = await this.store.manifestOf(path)
      if (!m || m.projectId === req.projectId) return path
    }
  }
}

export function indasFileStem(company: string, cy: { start: string; end: string }): string {
  const safe = company.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled company'
  const fy = /^\d{4}/.test(cy.start) && /^\d{4}/.test(cy.end) ? `${cy.start.slice(0, 4)}-${cy.end.slice(2, 4)}` : 'FY'
  return `${safe}_Ind AS_FY ${fy}`
}
