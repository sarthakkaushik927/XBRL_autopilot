/**
 * Opening, creating and closing filings (ADR-0017). The UI offers the current architecture only (Sarthak,
 * 2026-11-22): Ind AS projects. A C&I engine filing can still be open (e.g. a double-clicked .axbrl), so the use
 * cases close it first; a file saved by the earlier editor gets OLD_EDITOR_FILING instead of a failed open.
 */
import type { IndasDetails } from '@shared/indas'
import { OLD_EDITOR_FILING } from '@shared/project'
import { unwrap } from '@/lib/result'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'
import { toast } from '@/stores/toast'

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

/** File → Open: a project from the projects folder (or anywhere); its manifest says whether this version can open it. */
export async function openProjectFile(): Promise<void> {
  const picked = await unwrap(window.xap.indas.pickProject())
  if (!picked) return
  if (picked.kind === 'indas') await openIndasProject(picked.path)
  else toast.error(OLD_EDITOR_FILING)
}

/** File → Close: back to the start screen (an Ind AS filing's work is saved first). */
export async function closeFiling(): Promise<void> {
  if (useIndas.getState().open) await useIndas.getState().close()
  else await closeCi()
  await useProject.getState().refreshLists()
}
