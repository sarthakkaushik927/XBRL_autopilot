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
    retry: { retries: 2, baseMs: 0, maxMs: 0 },
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

  describe('retry fail-safe', () => {
    const PATH = '/api/v1/indas/recommend/'
    /** answers /health, and PATH from `answers` in turn (the last one repeats) */
    function scripted(answers: (() => Response)[]) {
      let i = 0
      return make((url) => (url.endsWith('/health') ? json(health) : answers[Math.min(i++, answers.length - 1)]()))
    }
    const hits = (calls: { url: string }[]) => calls.filter((c) => c.url.endsWith(PATH)).length

    it('retries a refused connection, then a 503, and answers', async () => {
      const { client, calls } = scripted([
        () => {
          throw refused()
        },
        () => json({ busy: 1 }, 503),
        () => json({ ok: 1 }),
      ])
      expect(await client.request('POST', PATH, {})).toEqual({ status: 200, data: { ok: 1 } })
      expect(hits(calls)).toBe(3)
      expect(client.getLogs().filter((l) => l.text.startsWith('Retrying POST')).length).toBe(2)
    })

    it('retries 429 / 502 / 504 too and returns the last answer when they keep coming', async () => {
      const { client, calls } = scripted([() => json({}, 429), () => json({}, 502), () => json({ gw: 1 }, 504)])
      expect(await client.request('POST', PATH, {})).toEqual({ status: 504, data: { gw: 1 } })
      expect(hits(calls)).toBe(3)
    })

    it('does not retry a 500, a 4xx or a timeout', async () => {
      for (const answer of [() => json({}, 500), () => json({}, 422)]) {
        const { client, calls } = scripted([answer])
        await client.request('POST', PATH, {})
        expect(hits(calls)).toBe(1)
      }
      const { client, calls } = scripted([
        () => {
          throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
        },
      ])
      await expect(client.request('POST', PATH, {})).rejects.toThrow('timed out')
      expect(hits(calls)).toBe(1)
    })

    it('a cancelled request is not retried', async () => {
      const stop = new AbortController()
      const { client, calls } = scripted([
        () => {
          stop.abort()
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        },
      ])
      await expect(client.request('POST', PATH, {}, 1000, stop.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(hits(calls)).toBe(1)
    })

    it('stopRetrying lets the running attempt answer but starts no retry', async () => {
      const stop = new AbortController()
      const { client, calls } = scripted([
        () => {
          stop.abort() // Cancel while the backend is working on it
          return json({}, 503)
        },
      ])
      await expect(client.request('POST', PATH, {}, 1000, undefined, { stopRetrying: stop.signal })).rejects.toMatchObject({ name: 'AbortError' })
      expect(hits(calls)).toBe(1)
      const stop2 = new AbortController()
      const ok = scripted([
        () => {
          stop2.abort()
          return json({ done: 1 })
        },
      ])
      expect(await ok.client.request('POST', PATH, {}, 1000, undefined, { stopRetrying: stop2.signal })).toEqual({ status: 200, data: { done: 1 } })
    })

    it('retries uploads and downloads as well', async () => {
      const { client, calls } = make((url) => {
        if (url.endsWith('/health')) return json(health)
        return calls.filter((c) => c.url === url).length === 1 ? json({}, 503) : json({ data: 1 })
      })
      expect((await client.upload('/api/v1/indas/transform', { field: 'file', fileName: 'a.xlsx', bytes: new Uint8Array([1]) })).status).toBe(200)
      expect((await client.download('/api/v1/indas/template')).status).toBe(200)
      expect(calls.filter((c) => !c.url.endsWith('/health')).length).toBe(4)
    })
  })

  it('getIfChanged sends the ETag and reports 304 without a body, else the new ETag and the answer', async () => {
    const { client, calls } = make((url, init) => {
      if (url.endsWith('/health')) return json(health)
      const sent = (init.headers as Record<string, string>)['If-None-Match']
      if (sent === '"v1"') return new Response(null, { status: 304 })
      return new Response(JSON.stringify({ data: 1, success: true, message: '' }), { status: 200, headers: { ETag: '"v1"' } })
    })
    expect(await client.getIfChanged('/api/v1/indas/authority', null)).toEqual({ status: 200, etag: '"v1"', data: { data: 1, success: true, message: '' } })
    expect(await client.getIfChanged('/api/v1/indas/authority', '"v1"')).toEqual({ status: 304, etag: '"v1"', data: null })
    const sent = calls.filter((c) => c.url.endsWith('/authority')).map((c) => (c.init.headers as Record<string, string>)['If-None-Match'] ?? null)
    expect(sent).toEqual([null, '"v1"'])
  })
})
