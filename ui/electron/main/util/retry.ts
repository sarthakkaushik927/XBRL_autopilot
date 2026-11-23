/**
 * Retry with backoff and cancellation (the app's fail-safe for backend calls). Electron-free.
 *
 * `attempt(n)` runs up to `retries + 1` times. After each failed attempt `decide(outcome)` says whether to try
 * again and, optionally, how long the server asked to wait (Retry-After). Between attempts it waits
 * `baseMs * 3^n` (± 25% jitter, at most `maxMs`).
 *
 * Cancellation:
 * - `signal` aborted: no new attempt starts and a wait in progress ends at once, with an `AbortError`;
 * - the running attempt is the caller's to stop (the same signal is usually passed to its `fetch`).
 */
export interface RetryOptions<T> {
  retries: number
  baseMs: number
  maxMs: number
  signal?: AbortSignal
  /** a failed attempt's outcome → retry (with the server's wait, if it gave one) or not */
  decide: (outcome: { value: T } | { error: unknown }) => { retry: false } | { retry: true; waitMs?: number }
  /** called before each retry (logging) */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void
  /** injectable for tests */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

export async function withRetry<T>(attempt: (n: number) => Promise<T>, opts: RetryOptions<T>): Promise<T> {
  const sleep = opts.sleep ?? abortableSleep
  const random = opts.random ?? Math.random
  for (let n = 0; ; n++) {
    throwIfAborted(opts.signal)
    let outcome: { value: T } | { error: unknown }
    try {
      outcome = { value: await attempt(n) }
    } catch (error) {
      // a cancelled request is never retried, and reports the cancel
      if (isAbortError(error)) throw error
      throwIfAborted(opts.signal)
      outcome = { error }
    }
    const verdict = n < opts.retries ? opts.decide(outcome) : { retry: false as const }
    if (!verdict.retry) {
      if ('error' in outcome) throw outcome.error
      return outcome.value
    }
    const backoff = opts.baseMs * 3 ** n * (0.75 + random() * 0.5)
    const delayMs = Math.round(Math.min(opts.maxMs, Math.max(backoff, verdict.waitMs ?? 0)))
    opts.onRetry?.({ attempt: n + 1, delayMs, reason: 'error' in outcome ? describe(outcome.error) : 'retryable answer' })
    await sleep(delayMs, opts.signal)
  }
}

/** Resolves after `ms`, or rejects with an AbortError as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Retry-After (seconds or an HTTP date) in ms; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason
  return isAbortError(reason) ? (reason as Error) : Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
