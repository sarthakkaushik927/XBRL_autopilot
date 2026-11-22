/**
 * The Ind AS pipeline's project file (docs/17): a `.axbrl` zip with the usual `manifest.json` (so the start
 * screen lists it) marked `kind: "indas"`, plus `indas.json` = the screen's work (canonical rows, tags,
 * masters). The old engine's parts (filing.json, mapping.json …) are not in it. Pure Node, unit-tested.
 */
import { rename, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import type { IndasDetails } from '@shared/indas'
import { AXBRL_FORMAT, AXBRL_FORMAT_VERSION, type AxbrlManifest } from './axbrl'

export const INDAS_KIND = 'indas'
/** 2: the filing settings moved into `details` (New project); version 1 drafts (`meta`) still open */
export const INDAS_DRAFT_VERSION = 2

export interface IndasFile {
  manifest: AxbrlManifest
  /** the renderer's saved work (opaque here; versioned by `version`) */
  draft: { version: number } & Record<string, unknown>
}

export class IndasFileError extends Error {}

export async function packIndas(f: IndasFile): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(f.manifest, null, 2))
  zip.file('indas.json', JSON.stringify(f.draft))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function unpackIndas(buf: Uint8Array): Promise<IndasFile> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf)
  } catch {
    throw new IndasFileError('Not a project file')
  }
  const manifestText = await zip.file('manifest.json')?.async('string')
  const draftText = await zip.file('indas.json')?.async('string')
  if (!manifestText || !draftText) throw new IndasFileError('Not an Ind AS project file')
  const manifest = JSON.parse(manifestText) as AxbrlManifest
  if (manifest.format !== AXBRL_FORMAT || manifest.kind !== INDAS_KIND) throw new IndasFileError('Not an Ind AS project file')
  const draft = JSON.parse(draftText) as IndasFile['draft']
  if (typeof draft?.version !== 'number' || draft.version > INDAS_DRAFT_VERSION) {
    throw new IndasFileError('This project was saved by a newer version of XBRL Autopilot')
  }
  return { manifest, draft }
}

/** Writes via a temporary file + rename, so a crash never leaves half a project. */
export async function writeIndas(file: string, f: IndasFile): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, await packIndas(f))
  await rm(file, { force: true })
  await rename(tmp, file)
}

export async function readIndas(file: string): Promise<IndasFile> {
  return unpackIndas(readFileSync(file))
}

export function indasManifest(input: {
  projectId: string
  appVersion: string
  createdAt: string
  updatedAt: string
  details: IndasDetails
}): AxbrlManifest {
  const d = input.details
  return {
    format: AXBRL_FORMAT,
    formatVersion: AXBRL_FORMAT_VERSION,
    kind: INDAS_KIND,
    appVersion: input.appVersion,
    projectId: input.projectId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    taxonomy: { id: 'ind_as_taxonomy', authorityHash: null },
    company: { name: d.companyName.trim(), cin: d.cin.trim() },
    filing: { reportType: d.reportType, cy: d.cy, py: d.py, firstFinancialYear: d.py === null, roundingLevel: d.level },
  }
}
