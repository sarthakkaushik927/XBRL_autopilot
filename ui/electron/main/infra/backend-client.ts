/**
 * BackendClient: the Python backend (FastAPI) is hosted separately (PR #15 review, docs/17): the app never starts or
 * stops it. Its base URL comes from the environment (`XAP_API_URL`, see `backendUrl`); this client checks its /health,
 * reports the connection status and proxies the renderer's and the services' requests to it.
 *
 * Local development: terminal 1 `make dev-server` (backend on :7860), terminal 2 `pnpm dev`.
 * Electron-free (fetch is injected), unit-tested in ui/test/backend-client.test.ts.
 */
import { EventEmitter } from 'node:events'
import type { HttpMethod, SidecarLogLine, SidecarResponse, SidecarStatus } from '@shared/ipc'
import type { RequestControl } from '../services/ports'
import { isAllowedSidecarPath, parseHealth } from '../sidecar-utils'
import { retryAfterMs, withRetry } from '../util/retry'

/** Where `make dev-server` serves the backend: the address used when no URL is configured. */
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:7860'
const MAX_LOG_LINES = 2000
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * The fail-safe on every backend call: a refused / reset connection (the backend restarting, a hosted instance
 * cycling) and 429 / 502 / 503 / 504 (busy, proxy, deploy) are tried again, up to `retries` more times.
 * Not retried: a timeout (the backend may still be working on it, an AI call would be paid twice), 4xx, 500 (a bug
 * doesn't go away on a retry), and anything once the caller cancelled.
 */
export const DEFAULT_RETRY = { retries: 2, baseMs: 500, maxMs: 10_000 }
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

/**
 * The backend's base URL: the first set of `XAP_API_URL` in the process environment, the dev `.env`, and the value
 * baked in at build time; else `DEFAULT_BACKEND_URL`. A trailing slash is dropped; anything but http(s) is refused.
 */
export function backendUrl(...candidates: (string | undefined | null)[]): string {
  const raw = candidates.map((c) => c?.trim()).find((c) => !!c) ?? DEFAULT_BACKEND_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`XAP_API_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`XAP_API_URL must be http(s): ${raw}`)
  return url.toString().replace(/\/+$/, '')
}

export interface BackendOptions {
  baseUrl: string
  /** sent as `Authorization: Bearer …` when the backend requires one (its XAP_TOKEN) */
  token?: string | null
  fetch?: typeof fetch
  /** health check interval while connected / while not (ms) */
  pollMs?: { up: number; down: number }
  /** the retry fail-safe (DEFAULT_RETRY); `retries: 0` turns it off */
  retry?: { retries: number; baseMs: number; maxMs: number }
}

export class BackendClient extends EventEmitter {
  private status: SidecarStatus = { state: 'starting' }
  private logs: SidecarLogLine[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private checking: Promise<void> | null = null
  private readonly fetch: typeof fetch
  private readonly poll: { up: number; down: number }

  constructor(private readonly opts: BackendOptions) {
    super()
    this.fetch = opts.fetch ?? ((...a) => fetch(...a))
    this.poll = opts.pollMs ?? { up: 15_000, down: 3_000 }
  }

  get baseUrl(): string {
    return this.opts.baseUrl
  }

  getStatus(): SidecarStatus {
    return this.status
  }

  getLogs(): SidecarLogLine[] {
    return [...this.logs]
  }

  /** Starts checking the backend's health (now, then periodically). */
  start(): Promise<void> {
    if (!this.running) {
      this.running = true
      this.log('system', `Backend: ${this.opts.baseUrl} (XAP_API_URL)`)
    }
    return this.checkNow()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** "Reconnect": checks the backend at once (it may have been started or restarted meanwhile). */
  reconnect(): Promise<void> {
    if (!this.running) return this.start()
    return this.checkNow()
  }

  /** Resolves once the backend answers /health; rejects after `timeoutMs`. */
  whenReady(timeoutMs: number): Promise<void> {
    if (this.status.state === 'ready') return Promise.resolve()
    void this.checkNow()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('status', onStatus)
        reject(new Error(this.unreachable()))
      }, timeoutMs)
      const onStatus = (s: SidecarStatus) => {
        if (s.state !== 'ready') return
        clearTimeout(timer)
        this.off('status', onStatus)
        resolve()
      }
      this.on('status', onStatus)
    })
  }

  /**
   * A JSON request to an allowed path; the answer is parsed as JSON when it is JSON.
   * `signal` cancels it: the running attempt is aborted and no retry starts. `control.stopRetrying` only ends the retries.
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal?: AbortSignal,
    control?: RequestControl,
  ): Promise<SidecarResponse<T>> {
    const res = await this.send(
      path,
      { method, body: body !== undefined ? JSON.stringify(body) : undefined, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {} },
      timeoutMs,
      signal,
      control,
    )
    return { status: res.status, data: parseBody<T>(await res.text()) }
  }

  /** A GET sent with If-None-Match when `etag` is given: 304 = the copy with that ETag is still current (no body). */
  async getIfChanged<T>(path: string, etag: string | null, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<{ status: number; etag: string | null; data: T | null }> {
    const res = await this.send(path, { method: 'GET', headers: etag ? { 'If-None-Match': etag } : {} }, timeoutMs, signal)
    if (res.status === 304) return { status: 304, etag, data: null }
    return { status: res.status, etag: res.headers.get('ETag'), data: parseBody<T>(await res.text()) }
  }

  /** Multipart upload of one file (e.g. /indas/transform); the answer is parsed like `request`. */
  async upload<T>(path: string, file: { field: string; fileName: string; bytes: Uint8Array }, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<SidecarResponse<T>> {
    const form = new FormData()
    form.append(file.field, new Blob([Uint8Array.from(file.bytes)]), file.fileName) // copy: Blob needs an ArrayBuffer-backed view
    const res = await this.send(path, { method: 'POST', body: form }, timeoutMs, signal)
    return { status: res.status, data: parseBody<T>(await res.text()) }
  }

  /** Binary GET (e.g. the standard template). */
  async download(path: string, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array }> {
    const res = await this.send(path, { method: 'GET' }, timeoutMs, signal)
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) }
  }

  /** One request with the retry fail-safe (DEFAULT_RETRY); each attempt gets its own timeout. */
  private async send(
    path: string,
    init: { method: string; body?: BodyInit; headers?: Record<string, string> },
    timeoutMs: number,
    stop?: AbortSignal,
    control?: RequestControl,
  ): Promise<Response> {
    if (!isAllowedSidecarPath(path)) throw new Error(`Backend path not allowed: ${path}`)
    const policy = this.opts.retry ?? DEFAULT_RETRY
    const cancel = [stop, control?.stopRetrying].filter((s): s is AbortSignal => !!s)
    try {
      return await withRetry(
        () =>
          this.fetch(`${this.opts.baseUrl}${path}`, {
            ...init,
            headers: { ...this.auth(), ...(init.headers ?? {}) },
            signal: stop ? AbortSignal.any([AbortSignal.timeout(timeoutMs), stop]) : AbortSignal.timeout(timeoutMs),
          }),
        {
          ...policy,
          signal: cancel.length > 1 ? AbortSignal.any(cancel) : cancel[0],
          decide: (o) => {
            if ('error' in o) return { retry: isConnectionError(o.error) }
            if (!RETRYABLE_STATUS.has(o.value.status)) return { retry: false }
            void o.value.body?.cancel().catch(() => undefined) // the retried answer's body is not read
            return { retry: true, waitMs: retryAfterMs(o.value.headers.get('Retry-After')) ?? undefined }
          },
          onRetry: ({ attempt, delayMs, reason }) => this.log('system', `Retrying ${init.method} ${path} (${attempt}/${policy.retries}) in ${delayMs} ms: ${reason}`),
        },
      )
    } catch (err) {
      // a refused connection means the backend went away: say so and look again soon
      if (isConnectionError(err)) {
        this.setDown(this.unreachable())
        throw new Error(this.unreachable())
      }
      throw err
    }
  }

  private auth(): Record<string, string> {
    return this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}
  }

  private unreachable(): string {
    return `The backend at ${this.opts.baseUrl} is not reachable. Start it (make dev-server) or set XAP_API_URL.`
  }

  /** One health check at a time; schedules the next one. */
  private checkNow(): Promise<void> {
    this.checking ??= this.check().finally(() => {
      this.checking = null
      this.schedule()
    })
    return this.checking
  }

  private async check(): Promise<void> {
    try {
      const res = await this.fetch(`${this.opts.baseUrl}/health`, { headers: this.auth(), signal: AbortSignal.timeout(5000) })
      const health = res.ok ? parseHealth(await res.json()) : null
      if (!health) return this.setDown(`The backend at ${this.opts.baseUrl} answered /health with ${res.status}.`)
      const next: SidecarStatus = { state: 'ready', url: this.opts.baseUrl, version: health.version, aiEnabled: Boolean(health.ai?.enabled), model: health.ai?.model ?? null }
      if (this.status.state !== 'ready') this.log('system', `Backend connected (v${health.version})`)
      if (!sameStatus(this.status, next)) this.setStatus(next)
    } catch (err) {
      // a slow /health from a connected backend means it is busy (auto-tagging blocks its loop), not gone
      if (this.status.state === 'ready' && !isConnectionError(err)) return
      this.setDown(this.unreachable())
    }
  }

  private setDown(message: string): void {
    if (this.status.state === 'error' && this.status.message === message) return
    if (this.status.state === 'ready') this.log('system', 'Backend connection lost')
    this.log('system', message)
    this.setStatus({ state: 'error', message })
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    if (!this.running) return
    this.timer = setTimeout(() => void this.checkNow(), this.status.state === 'ready' ? this.poll.up : this.poll.down)
    this.timer.unref?.()
  }

  private setStatus(s: SidecarStatus): void {
    this.status = s
    this.emit('status', s)
  }

  private log(stream: SidecarLogLine['stream'], text: string): void {
    const line: SidecarLogLine = { ts: Date.now(), stream, text: this.opts.token ? text.replaceAll(this.opts.token, '***') : text }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
    this.emit('log', line)
  }
}

function parseBody<T>(text: string): T {
  try {
    return (text ? JSON.parse(text) : null) as T
  } catch {
    return text as T // keep raw text
  }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === 'TimeoutError' || err.name === 'AbortError') return false
  const code = (err.cause as { code?: string } | undefined)?.code ?? ''
  return err instanceof TypeError || /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/.test(code)
}

function sameStatus(a: SidecarStatus, b: SidecarStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
