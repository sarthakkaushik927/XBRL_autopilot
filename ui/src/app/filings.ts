/**
 * Opening, creating and closing filings of either kind (ADR-0017). Only one filing is open at a time: a C&I engine
 * filing (useProject) or an Ind AS filing (useIndas). Each use case closes the other kind first (which saves an
 * Ind AS filing's work, or asks Save / Don't save for a C&I filing).
 */
import type { IndasDetails } from '@shared/indas'
import type { NewFilingInput } from '@shared/project'
import { unwrap } from '@/lib/result'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'

/** Closes the C&I filing; false when the user cancelled. */
async function closeCi(): Promise<boolean> {
  if (!useProject.getState().summary) return true
  await useProject.getState().close()
  return useProject.getState().summary === null
}

export async function createIndasProject(details: IndasDetails): Promise<string[]> {
  if (!(await closeCi())) return ['Close the open filing first.']
  return useIndas.getState().create(details)
}

export async function openIndasProject(path: string): Promise<void> {
  if (await closeCi()) await useIndas.getState().openSaved(path)
}

/** A C&I filing through the engine project path; returns the form's problems ([] = created). */
export async function openCiFilingNew(input: NewFilingInput): Promise<string[]> {
  if (!(await useIndas.getState().close())) return ['Save or close the open Ind AS filing first.']
  return useProject.getState().create(input)
}

export async function openCiFiling(path?: string): Promise<void> {
  if (await useIndas.getState().close()) await useProject.getState().open(path)
}

/** File → Open: one dialog for both kinds; the file's manifest says which editor opens it. */
export async function openProjectFile(): Promise<void> {
  const picked = await unwrap(window.xap.indas.pickProject())
  if (!picked) return
  if (picked.kind === 'indas') await openIndasProject(picked.path)
  else await openCiFiling(picked.path)
}

/** File → Close: back to the start screen (an Ind AS filing's work is saved first). */
export async function closeFiling(): Promise<void> {
  if (useIndas.getState().open) await useIndas.getState().close()
  else await closeCi()
  await useProject.getState().refreshLists()
}
