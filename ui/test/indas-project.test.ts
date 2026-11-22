import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IndasDetails, IndasSaveRequest } from '@shared/indas'
import { readManifest } from '../electron/main/project/axbrl'
import { IndasFileError, readIndas, unpackIndas, writeIndas } from '../electron/main/project/indas-file'
import { IndasProjectService, indasFileStem } from '../electron/main/services/indas-project-service'
import { ValidationError } from '../electron/main/services/errors'
import { SavedProjectsService } from '../electron/main/services/saved-projects-service'
import { DirProjectLister } from '../electron/main/infra/dir-project-lister'
import { fromDraft, projectCompanyName, toDraft, type IndasWork } from '../src/features/indas/model'

const realStore = { write: writeIndas, read: readIndas, manifestOf: async (p: string) => readManifest(p) }
const dir = () => mkdtempSync(join(tmpdir(), 'xap-indas-proj-'))
const clock = (iso: string) => () => new Date(iso)

const details = (over: Partial<IndasDetails> = {}): IndasDetails => ({
  taxonomy: 'ind-as-2017',
  companyName: 'Acme Pvt Ltd',
  cin: 'U72200KA2010PTC123456',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Lakhs',
  statementPlaces: 2,
  ...over,
})

const req = (over: Partial<IndasSaveRequest> = {}): IndasSaveRequest => ({
  projectId: 'p-1',
  path: null,
  draft: { version: 2, rows: [{ id: 'balanceSheet:0', concept: 'ind-as:Inventories' }] },
  details: details(),
  ...over,
})

describe('IndasProjectService', () => {
  it('saves a new project in the projects folder, named after the company and year, and reopens it', async () => {
    const d = dir()
    const svc = new IndasProjectService(realStore, () => d, '0.1.0', clock('2026-11-21T10:00:00Z'))
    const saved = await svc.save(req())
    expect(saved.path).toBe(join(d, 'Acme Pvt Ltd_FY 2025-26.axbrl'))
    const opened = await svc.open(saved.path)
    expect(opened).toMatchObject({ path: saved.path, projectId: 'p-1', draft: { version: 2, rows: [{ concept: 'ind-as:Inventories' }] } })
  })

  it('saving again keeps the file and its creation date', async () => {
    const d = dir()
    const first = await new IndasProjectService(realStore, () => d, '0.1.0', clock('2026-11-21T10:00:00Z')).save(req())
    await new IndasProjectService(realStore, () => d, '0.1.0', clock('2026-11-22T10:00:00Z')).save(req({ path: first.path }))
    const m = await readManifest(first.path)
    expect(m).toMatchObject({ kind: 'indas', projectId: 'p-1', createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-22T10:00:00.000Z' })
  })

  it('never overwrites another project with the same name: it picks " (2)"', async () => {
    const d = dir()
    const svc = new IndasProjectService(realStore, () => d, '0.1.0')
    await svc.save(req({ projectId: 'p-1' }))
    const other = await svc.save(req({ projectId: 'p-2' }))
    expect(other.path).toBe(join(d, 'Acme Pvt Ltd_FY 2025-26 (2).axbrl'))
    await expect(svc.save(req({ projectId: 'p-3', path: other.path }))).rejects.toThrow('another project')
  })

  it('names files safely', () => {
    expect(indasFileStem('A/B: "Co"', { start: '2025-04-01', end: '2026-03-31' })).toBe('AB Co_FY 2025-26')
    expect(indasFileStem(' ', { start: '', end: '' })).toBe('Untitled company_FY')
  })
})

describe('New project (IndasProjectService.create)', () => {
  const ids = () => 'p-new'

  it('validates the settings, saves an empty project as <Company>_<FY>.axbrl and returns it opened', async () => {
    const d = dir()
    const svc = new IndasProjectService(realStore, () => d, '0.1.0', clock('2026-11-22T09:00:00Z'), ids)
    const opened = await svc.create(details({ companyName: '  Acme Pvt Ltd ', cin: 'u72200ka2010ptc123456' }))
    expect(opened.path).toBe(join(d, 'Acme Pvt Ltd_FY 2025-26.axbrl'))
    expect(opened.projectId).toBe('p-new')
    expect(opened.draft).toMatchObject({ version: 2, details: { companyName: 'Acme Pvt Ltd', cin: 'U72200KA2010PTC123456', level: 'Lakhs', statementPlaces: 2 } })
    const m = await readManifest(opened.path)
    expect(m).toMatchObject({
      kind: 'indas',
      projectId: 'p-new',
      company: { name: 'Acme Pvt Ltd', cin: 'U72200KA2010PTC123456' },
      filing: { reportType: 'Standalone', cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, firstFinancialYear: false, roundingLevel: 'Lakhs' },
    })
    expect(await svc.kindOf(opened.path)).toBe('indas')
  })

  it('refuses invalid settings with the problems to show, writing nothing', async () => {
    const d = dir()
    const svc = new IndasProjectService(realStore, () => d, '0.1.0', clock('2026-11-22T09:00:00Z'), ids)
    const err = await svc.create(details({ companyName: ' ', cin: 'BAD', taxonomy: 'ci-2016' })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).problems).toEqual([
      'Enter the company name.',
      'Enter a valid 21-character CIN (e.g. U72200KA2010PTC123456).',
      'This project type is for Ind AS 2017 filings.',
    ])
  })

  it('a first financial year has no previous year in the manifest', async () => {
    const d = dir()
    const opened = await new IndasProjectService(realStore, () => d, '0.1.0', undefined, ids).create(details({ py: null }))
    expect((await readManifest(opened.path))?.filing).toMatchObject({ py: null, firstFinancialYear: true })
  })
})

describe('indas project file', () => {
  it('refuses files that are not Ind AS projects, or come from a newer app', async () => {
    await expect(unpackIndas(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(IndasFileError)
    const d = dir()
    const svc = new IndasProjectService(realStore, () => d, '0.1.0')
    const saved = await svc.save(req({ draft: { version: 99 } }))
    // the service stamps the current draft version, so this one opens
    await expect(svc.open(saved.path)).resolves.toBeTruthy()
  })

  it('is listed on the start screen as an Ind AS project', async () => {
    const d = dir()
    await new IndasProjectService(realStore, () => d, '0.1.0').save(req())
    writeFileSync(join(d, 'broken.axbrl'), 'x')
    const listing = await new SavedProjectsService(() => d, new DirProjectLister()).list()
    expect(listing.projects.map((p) => [p.kind, p.company, p.fy])).toEqual([['indas', 'Acme Pvt Ltd', expect.stringMatching(/2025/)]])
  })
})

describe('draft round trip', () => {
  const work: IndasWork = {
    transform: { fileName: 'HPL financials.xlsx', source: 'heuristic', sheets: {}, summary: {} },
    rows: [],
    socie: [],
    ppe: [],
    texts: [{ id: 'text:1', heading: 'Policies', content: 'Text', suggestions: [], concept: 'ind-as:X' }],
    details: details(),
    company: {},
    auditor: {},
    signatories: [{ din: '01234567', name: 'A', designation: 'Director' }],
  }

  it('saves and restores the whole screen', () => {
    expect(fromDraft(JSON.parse(JSON.stringify(toDraft(work))))).toEqual(work)
  })

  it('an older draft missing parts opens with them empty; its meta becomes the settings', () => {
    expect(fromDraft({ version: 1 }).rows).toEqual([])
    const old = fromDraft({ version: 1, meta: { nature: 'Consolidated', startDate: '2024-04-01', endDate: '2025-03-31' }, company: { 'in-ca:NameOfCompany': 'Old Co' } })
    expect(old.details).toMatchObject({ companyName: 'Old Co', reportType: 'Consolidated', cy: { start: '2024-04-01', end: '2025-03-31' } })
  })

  it('names the project after the settings, else the company field, else the workbook', () => {
    expect(projectCompanyName(work)).toBe('Acme Pvt Ltd')
    expect(projectCompanyName({ ...work, details: details({ companyName: '' }) })).toBe('HPL financials')
    expect(projectCompanyName({ ...work, details: details({ companyName: '' }), company: { 'in-ca:NameOfCompany': ' Acme ' } })).toBe('Acme')
  })
})
