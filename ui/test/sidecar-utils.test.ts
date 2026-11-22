import { describe, expect, it } from 'vitest'
import { isAllowedSidecarPath, parseHealth } from '../electron/main/sidecar-utils'

describe('isAllowedSidecarPath', () => {
  it('allows health and versioned API routes', () => {
    expect(isAllowedSidecarPath('/health')).toBe(true)
    expect(isAllowedSidecarPath('/api/v1/taxonomies')).toBe(true)
    expect(isAllowedSidecarPath('/api/v1/taxonomies/ci_taxonomy/concepts?search=share')).toBe(true)
  })
  it('rejects traversal, absolute URLs and other paths', () => {
    expect(isAllowedSidecarPath('/api/v1/../docs')).toBe(false)
    expect(isAllowedSidecarPath('http://evil/api/v1/x')).toBe(false)
    expect(isAllowedSidecarPath('/docs')).toBe(false)
    expect(isAllowedSidecarPath('api/v1/x')).toBe(false)
    expect(isAllowedSidecarPath('/api/v1\\x')).toBe(false)
  })
})

describe('parseHealth', () => {
  it('accepts a valid payload', () => {
    expect(parseHealth({ status: 'ok', version: '0.1.0', ai: { enabled: true, model: 'm' } })).toEqual({
      status: 'ok',
      version: '0.1.0',
      ai: { enabled: true, model: 'm' },
    })
  })
  it('rejects anything else', () => {
    expect(parseHealth(null)).toBeNull()
    expect(parseHealth({ status: 'down', version: '1' })).toBeNull()
    expect(parseHealth({ status: 'ok' })).toBeNull()
  })
})
