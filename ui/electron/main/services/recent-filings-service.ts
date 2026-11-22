/**
 * RecentFilingsService: the start screen's Recent filings, for the current architecture only (Sarthak, 2026-11-22:
 * no old-architecture things for now). Filings saved by the earlier engine editor can't open since the
 * `/taxonomies` routes were removed (docs/17 §3), so they are left out; Ind AS projects are remembered when they are
 * created, opened or saved. Electron-free: the recents table, the manifest reader and the clock are ports.
 */
import { fyLabel } from '@xap/engine/basics'
import type { RecentProject } from '@shared/project'
import type { AxbrlManifest } from '../project/axbrl'
import type { RecentProjectsRepository } from './ports'

export class RecentFilingsService {
  constructor(
    private readonly recents: RecentProjectsRepository,
    /** the project file's manifest; null when the file is missing or not a project */
    private readonly manifestOf: (path: string) => Promise<AxbrlManifest | null>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Recent Ind AS projects that still exist, newest first. */
  async list(): Promise<RecentProject[]> {
    const out: RecentProject[] = []
    for (const r of this.recents.list()) {
      const m = await this.manifestOf(r.path).catch(() => null)
      if (m?.kind === 'indas') out.push({ ...r, exists: true })
    }
    return out
  }

  /** Puts an Ind AS project on top of the list (its company, CIN and year from its manifest). */
  async remember(path: string): Promise<void> {
    const m = await this.manifestOf(path).catch(() => null)
    if (m?.kind !== 'indas') return
    this.recents.touch({ path, company: m.company.name, cin: m.company.cin, fy: fyLabel(m.filing.cy), openedAt: this.now().toISOString() })
  }

  forget(path: string): void {
    this.recents.remove(path)
  }
}
