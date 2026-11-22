/**
 * The two halves of the engine authority, both served by the sidecar from knowledge_base/:
 * the taxonomy (GET /api/v1/taxonomies/{id}/authority, ADR-0010) and the executable business rules
 * (GET /api/v1/taxonomies/{id}/engine-rules, ADR-0011).
 */
import type { TaxonomyId } from '@xap/engine/basics'
import { OLD_EDITOR_FILING } from '@shared/project'
import type { AuthorityJson, RuleBundleSource, SidecarClient, TaxonomyAuthoritySource } from '../services/ports'
import { SidecarCallError, sidecarCall } from './sidecar-call'
import { KB_TAXONOMY_ID } from './sidecar-taxonomy-catalog'

export class SidecarAuthoritySource implements TaxonomyAuthoritySource {
  constructor(
    private readonly sidecar: SidecarClient,
    private readonly readyTimeoutMs = 120_000,
  ) {}

  async taxonomyAuthority(taxonomy: TaxonomyId): Promise<AuthorityJson> {
    try {
      return await sidecarCall<AuthorityJson>(this.sidecar, 'GET', `/api/v1/taxonomies/${KB_TAXONOMY_ID[taxonomy]}/authority`, {
        readyTimeoutMs: this.readyTimeoutMs,
        what: 'Taxonomy service',
      })
    } catch (err) {
      // the route was removed with Vashu's pipeline (docs/17 §3): say what that means instead of "error (404)"
      if (err instanceof SidecarCallError && err.status === 404) throw new Error(ENGINE_ROUTES_REMOVED)
      throw err
    }
  }
}

/** Shown when an engine (C&I editor) filing is opened but the sidecar no longer serves the engine's taxonomy routes. */
export const ENGINE_ROUTES_REMOVED = OLD_EDITOR_FILING

/** A taxonomy without built rules (404, e.g. Costing) gets null, which means an empty rule model. */
export class SidecarRuleBundleSource implements RuleBundleSource {
  constructor(
    private readonly sidecar: SidecarClient,
    private readonly readyTimeoutMs = 120_000,
  ) {}

  async rules(taxonomy: TaxonomyId): Promise<AuthorityJson | null> {
    try {
      return await sidecarCall<AuthorityJson>(this.sidecar, 'GET', `/api/v1/taxonomies/${KB_TAXONOMY_ID[taxonomy]}/engine-rules`, {
        readyTimeoutMs: this.readyTimeoutMs,
        what: 'Rule service',
      })
    } catch (err) {
      if (err instanceof SidecarCallError && err.status === 404) return null
      throw err
    }
  }
}
