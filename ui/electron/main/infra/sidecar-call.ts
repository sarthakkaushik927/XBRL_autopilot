/** Calls a sidecar route and unwraps its {data, success, message} envelope (api/responses.py). Shared by the adapters. */
import type { HttpMethod } from '@shared/ipc'
import type { SidecarClient } from '../services/ports'

export interface Envelope<T> {
  data: T
  success: boolean
  message: string
}

/** A route answered with an error; `status` lets adapters tell "not available" (404) from a failure. */
export class SidecarCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SidecarCallError'
  }
}

/** The `data` of a route's answer, or a SidecarCallError with the route's message. */
export function unwrapEnvelope<T>(status: number, body: Envelope<T> | null | undefined, what = 'AI engine'): T {
  if (status !== 200 || !body?.success) throw new SidecarCallError(body?.message || `${what} error (${status})`, status)
  return body.data
}

export async function sidecarCall<T>(
  sidecar: SidecarClient,
  method: HttpMethod,
  path: string,
  {
    body,
    readyTimeoutMs = 120_000,
    timeoutMs,
    what = 'AI engine',
    signal,
    stopRetrying,
  }: {
    body?: unknown
    readyTimeoutMs?: number
    timeoutMs?: number
    what?: string
    /** cancels the request and its retries */
    signal?: AbortSignal
    /** ends the retries only; the running attempt finishes */
    stopRetrying?: AbortSignal
  } = {},
): Promise<T> {
  await sidecar.whenReady(readyTimeoutMs)
  const res = await sidecar.request<Envelope<T>>(method, path, body, timeoutMs, signal, stopRetrying ? { stopRetrying } : undefined)
  return unwrapEnvelope(res.status, res.data, what)
}
