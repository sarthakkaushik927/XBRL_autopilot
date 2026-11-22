import { describe, expect, it } from 'vitest'
import { ENGINE_ROUTES_REMOVED, SidecarAuthoritySource } from '../electron/main/infra/sidecar-authority-source'
import type { SidecarClient } from '../electron/main/services/ports'

const sidecar = (status: number, data: unknown): SidecarClient =>
  ({ whenReady: async () => {}, request: async () => ({ status, data }) }) as unknown as SidecarClient

describe('SidecarAuthoritySource', () => {
  it('an old engine filing on a sidecar without the /taxonomies routes gets a message that says so', async () => {
    await expect(new SidecarAuthoritySource(sidecar(404, { success: false, message: '' })).taxonomyAuthority('ind-as-2017')).rejects.toThrow(ENGINE_ROUTES_REMOVED)
  })

  it('other failures keep their own message', async () => {
    await expect(new SidecarAuthoritySource(sidecar(500, { success: false, message: 'boom' })).taxonomyAuthority('ci-2016')).rejects.toThrow('boom')
  })
})
