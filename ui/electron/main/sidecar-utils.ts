/**
 * Pure helpers for the backend client (no Electron imports, unit-tested in ui/test).
 */

/** Paths the renderer may call through `sidecar:request`. Everything else is rejected. */
export function isAllowedSidecarPath(path: string): boolean {
  if (typeof path !== 'string' || path.length > 2048) return false
  if (!path.startsWith('/')) return false
  if (path.includes('..') || path.includes('\\') || path.includes('://')) return false
  return path === '/health' || path.startsWith('/health?') || path.startsWith('/api/v1/')
}

export interface HealthPayload {
  status: string
  version: string
  ai?: { enabled?: boolean; model?: string | null }
}

export function parseHealth(body: unknown): HealthPayload | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.status !== 'ok' || typeof b.version !== 'string') return null
  const ai = (b.ai && typeof b.ai === 'object' ? b.ai : {}) as HealthPayload['ai']
  return { status: 'ok', version: b.version, ai }
}
