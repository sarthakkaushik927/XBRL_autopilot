import { describe, expect, it } from 'vitest'
import { abortableSleep, retryAfterMs, withRetry } from '../electron/main/util/retry'

const noSleep = async (_ms: number, signal?: AbortSignal) => {
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
}
const always = () => ({ retry: true as const })

describe('withRetry', () => {
  it('tries again until an attempt succeeds', async () => {
    let n = 0
    const out = await withRetry(async () => (++n < 3 ? Promise.reject(new Error('flaky')) : 'ok'), { retries: 2, baseMs: 1, maxMs: 10, decide: always, sleep: noSleep })
    expect(out).toBe('ok')
    expect(n).toBe(3)
  })

  it('gives up after `retries` more attempts with the last error', async () => {
    let n = 0
    await expect(withRetry(async () => Promise.reject(new Error(`fail ${++n}`)), { retries: 2, baseMs: 1, maxMs: 10, decide: always, sleep: noSleep })).rejects.toThrow('fail 3')
  })

  it('returns a retryable answer as is once the retries are used up', async () => {
    let n = 0
    const out = await withRetry(async () => ({ status: 503, n: ++n }), { retries: 1, baseMs: 1, maxMs: 10, decide: always, sleep: noSleep })
    expect(out).toEqual({ status: 503, n: 2 })
  })

  it('does not retry what `decide` refuses', async () => {
    let n = 0
    await expect(
      withRetry(async () => Promise.reject(new Error(`no ${++n}`)), { retries: 3, baseMs: 1, maxMs: 10, decide: () => ({ retry: false }), sleep: noSleep }),
    ).rejects.toThrow('no 1')
  })

  it('backs off 3× per attempt with jitter, capped, and honours a longer server wait', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => void waits.push(ms)
    let n = 0
    await withRetry(async () => (++n < 4 ? Promise.reject(new Error('x')) : 1), {
      retries: 3,
      baseMs: 100,
      maxMs: 500,
      decide: () => ({ retry: true, waitMs: n === 1 ? 250 : undefined }),
      sleep,
      random: () => 0.5, // no jitter
    })
    expect(waits).toEqual([250, 300, 500])
  })

  it('never retries a cancelled attempt', async () => {
    let n = 0
    const abort = Object.assign(new Error('stopped'), { name: 'AbortError' })
    await expect(withRetry(async () => (n++, Promise.reject(abort)), { retries: 3, baseMs: 1, maxMs: 10, decide: always, sleep: noSleep })).rejects.toThrow('stopped')
    expect(n).toBe(1)
  })

  it('cancelling during the wait ends it at once and starts no attempt', async () => {
    const stop = new AbortController()
    let n = 0
    const run = withRetry(
      async () => {
        n++
        queueMicrotask(() => stop.abort())
        throw new Error('down')
      },
      { retries: 5, baseMs: 60_000, maxMs: 60_000, signal: stop.signal, decide: always },
    )
    const t0 = Date.now()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(n).toBe(1)
  })

  it('starts nothing when already cancelled', async () => {
    let n = 0
    await expect(withRetry(async () => ++n, { retries: 1, baseMs: 1, maxMs: 1, signal: AbortSignal.abort(), decide: always })).rejects.toMatchObject({ name: 'AbortError' })
    expect(n).toBe(0)
  })
})

describe('abortableSleep / retryAfterMs', () => {
  it('sleeps, or rejects when aborted', async () => {
    await expect(abortableSleep(1)).resolves.toBeUndefined()
    await expect(abortableSleep(10_000, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('reads Retry-After in seconds or as a date', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs('soon')).toBeNull()
  })
})
