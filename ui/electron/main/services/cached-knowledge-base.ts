/**
 * CachedKnowledgeBase: the Ind AS knowledge base (/api/v1/indas/authority) kept on disk between sessions
 * (docs/18 "Faster first open"). Electron-free: the backend and the store come in as ports.
 *
 * The copy on disk is used only when the server says it is current: the request carries its ETag
 * (If-None-Match) and the server answers 304. Anything else is a normal download, so results never change:
 * - the server sends no ETag (today's backend): nothing is kept, every session downloads, exactly as before;
 * - the copy came from another server (XAP_API_URL changed): it is not offered;
 * - the store can't be read or written: a normal download.
 */
import type { Envelope } from '../infra/sidecar-call'
import { unwrapEnvelope } from '../infra/sidecar-call'
import type { IndasKnowledgeBase } from './indas-knowledge-base'
import type { CachedAnswerStore, ConditionalGetClient, SidecarClient } from './ports'

export const AUTHORITY_PATH = '/api/v1/indas/authority'
const TIMEOUT_MS = 300_000
const WHAT = 'Knowledge base'

/** Supplies the Ind AS knowledge base (IndasPipelineService keeps it in memory for the session). */
export interface KnowledgeBaseSource {
  load(): Promise<IndasKnowledgeBase>
}

export class CachedKnowledgeBase implements KnowledgeBaseSource {
  constructor(
    private readonly backend: Pick<SidecarClient, 'whenReady'> & ConditionalGetClient,
    private readonly store: CachedAnswerStore<IndasKnowledgeBase>,
    /** the server's base URL: a copy is only offered back to the server it came from */
    private readonly source: string,
  ) {}

  async load(): Promise<IndasKnowledgeBase> {
    await this.backend.whenReady(120_000)
    const cached = await this.store.read().then((c) => (c?.source === this.source ? c : null))
    const res = await this.backend.getIfChanged<Envelope<IndasKnowledgeBase>>(AUTHORITY_PATH, cached?.etag ?? null, TIMEOUT_MS)
    if (res.status === 304 && cached) return cached.data
    if (res.status === 304) return this.download() // a 304 we didn't ask for: fetch it whole
    const kb = unwrapEnvelope(res.status, res.data, WHAT)
    if (res.etag) await this.store.write({ source: this.source, etag: res.etag, data: kb }).catch(() => undefined) // a cache that can't be written is only slower
    return kb
  }

  private async download(): Promise<IndasKnowledgeBase> {
    const res = await this.backend.getIfChanged<Envelope<IndasKnowledgeBase>>(AUTHORITY_PATH, null, TIMEOUT_MS)
    return unwrapEnvelope(res.status, res.data, WHAT)
  }
}
