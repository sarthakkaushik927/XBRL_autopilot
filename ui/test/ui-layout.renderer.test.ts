/**
 * Renderer-side test: type-checked with tsconfig.web.json (*.renderer.test.ts files).
 * Layout toggles (side panel / bottom panel) and their memory across restarts.
 */
import { describe, expect, it } from 'vitest'
import { LAYOUT_KEY, loadLayout, saveLayout, useUi } from '../src/stores/ui'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('layout memory', () => {
  it('both panels are shown when nothing is remembered', () => {
    expect(loadLayout(memory())).toEqual({ sidebarOpen: true, bottomOpen: true })
    expect(loadLayout(undefined)).toEqual({ sidebarOpen: true, bottomOpen: true })
  })

  it('remembers a hidden bottom panel; junk or partial values fall back per field', () => {
    const s = memory()
    saveLayout(s, { sidebarOpen: true, bottomOpen: false })
    expect(loadLayout(s)).toEqual({ sidebarOpen: true, bottomOpen: false })
    expect(loadLayout(memory({ [LAYOUT_KEY]: '{"bottomOpen":"no"}' }))).toEqual({ sidebarOpen: true, bottomOpen: true })
    expect(loadLayout(memory({ [LAYOUT_KEY]: 'not json' }))).toEqual({ sidebarOpen: true, bottomOpen: true })
  })

  it('a storage that throws never breaks the app', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(loadLayout(broken)).toEqual({ sidebarOpen: true, bottomOpen: true })
    expect(() => saveLayout(broken, { sidebarOpen: false, bottomOpen: false })).not.toThrow()
  })
})

describe('layout toggles', () => {
  it('hide and show the bottom panel; showing a tab (Problems) opens it again', () => {
    useUi.setState({ bottomOpen: true, bottomTab: 'output' })
    useUi.getState().toggleBottom()
    expect(useUi.getState().bottomOpen).toBe(false)
    useUi.getState().setBottomTab('problems')
    expect(useUi.getState()).toMatchObject({ bottomOpen: true, bottomTab: 'problems' })
  })

  it('the side panel toggles; clicking the active activity hides it, another one shows it', () => {
    useUi.setState({ sidebarOpen: true, activity: 'explorer' })
    useUi.getState().toggleSidebar()
    expect(useUi.getState().sidebarOpen).toBe(false)
    useUi.getState().setActivity('taxonomy')
    expect(useUi.getState()).toMatchObject({ sidebarOpen: true, activity: 'taxonomy' })
    useUi.getState().setActivity('taxonomy')
    expect(useUi.getState().sidebarOpen).toBe(false)
  })
})
