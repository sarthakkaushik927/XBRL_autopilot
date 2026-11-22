import type { IpcError, Result } from '@shared/ipc'
import { useActivity } from '@/stores/activity'
import { toast } from '@/stores/toast'

/**
 * Unwraps an IPC Result. On failure it shows a toast (unless `quiet`) and returns undefined.
 * Validation errors are returned to forms through `onValidation` instead of a toast.
 */
export async function unwrap<T>(
  call: Promise<Result<T>>,
  opts: { quiet?: boolean; quietWhen?: (e: IpcError) => boolean; onValidation?: (problems: string[]) => void } = {},
): Promise<T | undefined> {
  const r = await useActivity.getState().track(call)
  if (r.ok) return r.value
  report(r.error, opts)
  return undefined
}

function report(e: IpcError, opts: { quiet?: boolean; quietWhen?: (e: IpcError) => boolean; onValidation?: (problems: string[]) => void }): void {
  if (e.kind === 'validation' && opts.onValidation) return opts.onValidation(e.problems)
  if (opts.quietWhen?.(e)) return
  if (!opts.quiet) toast.error(e.message)
}
