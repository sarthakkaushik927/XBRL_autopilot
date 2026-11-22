import { describe, expect, it } from 'vitest'
import type { RecentProject } from '@shared/project'
import type { AxbrlManifest } from '../electron/main/project/axbrl'
import { RecentFilingsService } from '../electron/main/services/recent-filings-service'
import type { RecentProjectsRepository } from '../electron/main/services/ports'

const repo = (): RecentProjectsRepository & { rows: Omit<RecentProject, 'exists'>[] } => {
  const rows: Omit<RecentProject, 'exists'>[] = []
  return {
    rows,
    touch: (e) => {
      const i = rows.findIndex((r) => r.path === e.path)
      if (i >= 0) rows.splice(i, 1)
      rows.unshift(e)
    },
    list: () => rows,
    remove: (p) => void rows.splice(rows.findIndex((r) => r.path === p), 1),
  }
}

const manifest = (kind: string | undefined, name = 'Acme Pvt Ltd'): AxbrlManifest =>
  ({ kind, company: { name, cin: 'U72200KA2010PTC123456' }, filing: { cy: { start: '2025-04-01', end: '2026-03-31' } } }) as unknown as AxbrlManifest

describe('RecentFilingsService (current architecture only)', () => {
  const files: Record<string, AxbrlManifest | null> = {
    'C:/P/Acme_FY 2025-26.axbrl': manifest('indas'),
    'C:/Downloads/DIXON_FY 2025-26_Standalone.axbrl': manifest(undefined, 'DIXON'), // saved by the earlier engine editor
    'C:/gone.axbrl': null,
  }
  const svc = (r = repo()) => ({ r, s: new RecentFilingsService(r, async (p) => files[p] ?? null, () => new Date('2026-11-22T10:00:00Z')) })

  it('remembers an Ind AS project with its company, CIN and year', async () => {
    const { r, s } = svc()
    await s.remember('C:/P/Acme_FY 2025-26.axbrl')
    expect(r.rows).toEqual([{ path: 'C:/P/Acme_FY 2025-26.axbrl', company: 'Acme Pvt Ltd', cin: 'U72200KA2010PTC123456', fy: 'FY 2025-26', openedAt: '2026-11-22T10:00:00.000Z' }])
  })

  it('never lists old-editor filings or missing files, and never remembers them', async () => {
    const { r, s } = svc()
    r.touch({ path: 'C:/Downloads/DIXON_FY 2025-26_Standalone.axbrl', company: 'DIXON', cin: 'U1', fy: 'FY 2025-26', openedAt: '2026-11-11T08:00:00Z' })
    r.touch({ path: 'C:/gone.axbrl', company: 'Gone', cin: 'U2', fy: 'FY 2024-25', openedAt: '2026-11-10T08:00:00Z' })
    await s.remember('C:/Downloads/DIXON_FY 2025-26_Standalone.axbrl')
    await s.remember('C:/P/Acme_FY 2025-26.axbrl')
    expect((await s.list()).map((p) => [p.company, p.exists])).toEqual([['Acme Pvt Ltd', true]])
    s.forget('C:/P/Acme_FY 2025-26.axbrl')
    expect(await s.list()).toEqual([])
  })
})
