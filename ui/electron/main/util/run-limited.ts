/**
 * A small concurrency limit for independent requests (docs/18: parallel Auto-tag batches). Electron-free.
 *
 * Runs `task(0)`, `task(1)`, … `task(count - 1)` with at most `limit` running at once. Tasks start in index order.
 * - `firstAlone`: task 0 finishes before the others start (a backend that fills a cache on its first call — the
 *   scope's embeddings — then fills it once instead of once per parallel request).
 * - No task starts once `signal` is aborted or a task has failed; the running ones finish first.
 *
 * Resolves `true` when every task ran, `false` when `signal` stopped it before the last one started.
 * Rejects with the first task's error.
 */
export async function runLimited(
  count: number,
  limit: number,
  task: (index: number) => Promise<void>,
  { signal, firstAlone = false }: { signal?: AbortSignal; firstAlone?: boolean } = {},
): Promise<boolean> {
  let next = 0
  // set inside the tasks' callbacks, so not narrowed to `null` here
  let failure = null as { error: unknown } | null
  const canStart = () => next < count && failure === null && !signal?.aborted
  const runNext = async () => {
    const i = next++
    try {
      await task(i)
    } catch (error) {
      failure ??= { error }
    }
  }
  const worker = async () => {
    while (canStart()) await runNext()
  }

  if (firstAlone && canStart()) await runNext()
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count - next)) }, worker))
  if (failure) throw failure.error
  return next === count
}
