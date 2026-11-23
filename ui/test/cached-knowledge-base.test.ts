import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonFileCache } from '../electron/main/infra/json-file-cache'
import { AUTHORITY_PATH, CachedKnowledgeBase } from '../electron/main/services/cached-knowledge-base'
import type { IndasKnowledgeBase } from '../electron/main/services/indas-knowledge-base'
import type { CachedAnswer, CachedAnswerStore } from '../electron/main/services/ports'

const SERVER = 'http://backend.test'
const KB = { concepts: { a: 1 } } as unknown as IndasKnowledgeBase
const NEWER = { concepts: { a: 2 } } as unknown as IndasKnowledgeBase
const ok = (data: IndasKnowledgeBase) => ({ data, success: true, message: '' })

/** A backend whose /authority answers like an HTTP server with (or without) ETags; it records the ETag sent. */
function backend(current: { kb: IndasKnowledgeBase; etag: string | null }, status = 200) {
  const sent: (string | null)[] = []
  return {
    sent,
    whenReady: async () => undefined,
    getIfChanged: async <T>(path: string, etag: string | null) => {
      expect(path).toBe(AUTHORITY_PATH)
      sent.push(etag)
      if (status !== 200) return { status, etag: null, data: { data: null, success: false, message: 'Knowledge Base file not found' } as T }
      if (etag && etag === current.etag) return { status: 304, etag, data: null }
      return { status: 200, etag: current.etag, data: ok(current.kb) as T }
    },
  }
}

function memoryStore(initial: CachedAnswer<IndasKnowledgeBase> | null = null, failWrites = false) {
  const s = { entry: initial, writes: 0 }
  const store: CachedAnswerStore<IndasKnowledgeBase> = {
    read: async () => s.entry,
    write: async (e) => {
      if (failWrites) throw new Error('disk full')
      s.writes++
      s.entry = e
    },
  }
  return { s, store }
}

describe('CachedKnowledgeBase', () => {
  it('without an ETag from the server keeps nothing and downloads every time (as before)', async () => {
    const b = backend({ kb: KB, etag: null })
    const { s, store } = memoryStore()
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(KB)
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(KB)
    expect(s.writes).toBe(0)
    expect(b.sent).toEqual([null, null])
  })

  it('keeps the copy with its ETag; the next session gets 304 and uses it', async () => {
    const b = backend({ kb: KB, etag: '"v1"' })
    const { s, store } = memoryStore()
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(KB)
    expect(s.entry).toEqual({ source: SERVER, etag: '"v1"', data: KB })
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(KB)
    expect(b.sent).toEqual([null, '"v1"'])
    expect(s.writes).toBe(1)
  })

  it('downloads again and replaces the copy when the server has a new version', async () => {
    const current = { kb: KB, etag: '"v1"' as string | null }
    const b = backend(current)
    const { s, store } = memoryStore()
    await new CachedKnowledgeBase(b, store, SERVER).load()
    Object.assign(current, { kb: NEWER, etag: '"v2"' })
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(NEWER)
    expect(s.entry?.etag).toBe('"v2"')
  })

  it("never offers a copy from another server (XAP_API_URL changed)", async () => {
    const b = backend({ kb: NEWER, etag: '"v1"' })
    const { store } = memoryStore({ source: 'http://other.test', etag: '"v1"', data: KB })
    expect(await new CachedKnowledgeBase(b, store, SERVER).load()).toEqual(NEWER)
    expect(b.sent).toEqual([null])
  })

  it('a 304 it did not ask for is fetched whole', async () => {
    const b = { whenReady: async () => undefined, calls: 0, getIfChanged: async <T>() => (b.calls++ === 0 ? { status: 304, etag: null, data: null } : { status: 200, etag: null, data: ok(KB) as T }) }
    expect(await new CachedKnowledgeBase(b, memoryStore().store, SERVER).load()).toEqual(KB)
    expect(b.calls).toBe(2)
  })

  it('a cache that cannot be written only costs speed', async () => {
    const { store } = memoryStore(null, true)
    expect(await new CachedKnowledgeBase(backend({ kb: KB, etag: '"v1"' }), store, SERVER).load()).toEqual(KB)
  })

  it("passes on the server's error", async () => {
    await expect(new CachedKnowledgeBase(backend({ kb: KB, etag: null }, 500), memoryStore().store, SERVER).load()).rejects.toThrow('Knowledge Base file not found')
  })
})

describe('JsonFileCache', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'xap-kb-')), 'cache', 'kb.json')

  it('round-trips an entry (creating the folder)', async () => {
    const f = file()
    const cache = new JsonFileCache<IndasKnowledgeBase>(f)
    expect(await cache.read()).toBeNull()
    await cache.write({ source: SERVER, etag: 'W/"abc"', data: KB })
    expect(await cache.read()).toEqual({ source: SERVER, etag: 'W/"abc"', data: KB })
    expect(JSON.parse(readFileSync(f, 'utf8')).etag).toBe('W/"abc"')
  })

  it('reads a damaged or foreign file as no cache', async () => {
    const f = file()
    const cache = new JsonFileCache<IndasKnowledgeBase>(f)
    await cache.write({ source: SERVER, etag: '"x"', data: KB })
    writeFileSync(f, '{"source": "x", "eta')
    expect(await cache.read()).toBeNull()
    writeFileSync(f, JSON.stringify({ hello: 1 }))
    expect(await cache.read()).toBeNull()
  })
})
