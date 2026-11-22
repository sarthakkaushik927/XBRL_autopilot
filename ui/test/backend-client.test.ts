import { afterEach, describe, expect, it } from 'vitest'
import { BackendClient, backendUrl, DEFAULT_BACKEND_URL } from '../electron/main/infra/backend-client'

const health = { status: 'ok', version: '0.1.0', ai: { enabled: true, model: 'm' } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })

let client: BackendClient | null = null
afterEach(() => client?.stop())

/** A client over a fake fetch that records every call. */
function make(handler: (url: string, init: RequestInit) => Response | Promise<Response>, token?: string) {
  const calls: { url: string; init: RequestInit }[] = []
  client = new BackendClient({
    baseUrl: 'http://backend.test',
    token,
    pollMs: { up: 60_000, down: 60_000 },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof fetch,
  })
  return { client, calls }
}

describe('backendUrl', () => {
  it('takes the first configured URL and drops a trailing slash', () => {
    expect(backendUrl(undefined, '  ', 'https://api.example.com/')).toBe('https://api.example.com')
    expect(backendUrl('http://10.0.0.5:9000', 'https://other')).toBe('http://10.0.0.5:9000')
  })
  it('falls back to the dev server address', () => {
    expect(backendUrl(undefined, null, '')).toBe(DEFAULT_BACKEND_URL)
  })
  it('refuses anything but http(s)', () => {
    expect(() => backendUrl('file:///etc/passwd')).toThrow(/http/)
    expect(() => backendUrl('not a url')).toThrow(/valid URL/)
  })
})

describe('BackendClient', () => {
  it('is ready once /health answers, with the AI status', async () => {
    const { client } = make(() => json(health))
    await client.start()
    expect(client.getStatus()).toEqual({ state: 'ready', url: 'http://backend.test', version: '0.1.0', aiEnabled: true, model: 'm' })
    await expect(client.whenReady(10)).resolves.toBeUndefined()
  })

  it('reports an unreachable backend and how to start it', async () => {
    const { client } = make(() => {
      throw refused()
    })
    await client.start()
    const s = client.getStatus()
    expect(s.state).toBe('error')
    expect(s.state === 'error' && s.message).toMatch(/make dev-server/)
    await expect(client.whenReady(20)).rejects.toThrow(/not reachable/)
  })

  it('connects on reconnect once the backend is up', async () => {
    let up = false
    const { client } = make(() => {
      if (!up) throw refused()
      return json(health)
    })
    await client.start()
    expect(client.getStatus().state).toBe('error')
    up = true
    await client.reconnect()
    expect(client.getStatus().state).toBe('ready')
  })

  it('proxies JSON requests to the base URL with the token, and refuses other paths', async () => {
    const { client, calls } = make((url) => (url.endsWith('/health') ? json(health) : json({ ok: 1 })), 'secret')
    const res = await client.request('POST', '/api/v1/indas/recommend/', { keys: ['a'] })
    expect(res).toEqual({ status: 200, data: { ok: 1 } })
    const call = calls.find((c) => c.url.endsWith('/recommend/'))!
    expect(call.url).toBe('http://backend.test/api/v1/indas/recommend/')
    expect(call.init.headers).toMatchObject({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' })
    expect(call.init.body).toBe(JSON.stringify({ keys: ['a'] }))
    await expect(client.request('GET', '/docs')).rejects.toThrow(/not allowed/)
  })

  it('stays connected when a busy backend answers /health too slowly', async () => {
    let busy = false
    const { client } = make(() => {
      if (busy) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      return json(health)
    })
    await client.start()
    busy = true
    await client.reconnect()
    expect(client.getStatus().state).toBe('ready')
  })

  it('marks the backend unreachable when a request is refused', async () => {
    let up = true
    const { client } = make(() => {
      if (!up) throw refused()
      return json(health)
    })
    await client.start()
    up = false
    await expect(client.request('GET', '/api/v1/indas/authority')).rejects.toThrow(/not reachable/)
    expect(client.getStatus().state).toBe('error')
    expect(client.getLogs().map((l) => l.text)).toContain('Backend connection lost')
  })
})
