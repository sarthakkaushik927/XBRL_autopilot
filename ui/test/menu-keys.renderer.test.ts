/** Renderer-side test: Alt-key access to the custom title bar's menus (src/app/menu-keys.ts). */
import { describe, expect, it } from 'vitest'
import { AltTap, letterIndex, mnemonicIndex, mnemonicPosition } from '../src/app/menu-keys'

const NAMES = [
  { label: 'File', mnemonic: 'f' },
  { label: 'Edit', mnemonic: 'e' },
  { label: 'Filing', mnemonic: 'i' },
]
const key = (k: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat', boolean>> = {}) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

describe('Alt+letter', () => {
  it('opens the menu with that access key, whatever the case', () => {
    expect(mnemonicIndex(NAMES, key('f', { altKey: true }))).toBe(0)
    expect(mnemonicIndex(NAMES, key('I', { altKey: true }))).toBe(2)
  })

  it('leaves other shortcuts alone: no Alt, AltGr (Ctrl+Alt), Alt+Shift, unknown letters', () => {
    expect(mnemonicIndex(NAMES, key('f'))).toBe(-1)
    expect(mnemonicIndex(NAMES, key('f', { altKey: true, ctrlKey: true }))).toBe(-1)
    expect(mnemonicIndex(NAMES, key('f', { altKey: true, shiftKey: true }))).toBe(-1)
    expect(mnemonicIndex(NAMES, key('z', { altKey: true }))).toBe(-1)
    expect(mnemonicIndex(NAMES, key('ArrowLeft', { altKey: true }))).toBe(-1)
  })

  it('a plain letter opens a menu once the bar has the focus; the underline sits on the access key', () => {
    expect(letterIndex(NAMES, 'e')).toBe(1)
    expect(letterIndex(NAMES, 'Enter')).toBe(-1)
    expect(mnemonicPosition(NAMES[2]!)).toBe(1)
    expect(mnemonicPosition({ label: 'X', mnemonic: null })).toBe(-1)
  })
})

describe('lone Alt tap', () => {
  it('Alt down then up enters the bar', () => {
    const t = new AltTap()
    t.keyDown(key('Alt', { altKey: true }))
    expect(t.keyUp(key('Alt'))).toBe(true)
    expect(t.keyUp(key('Alt'))).toBe(false) // only once
  })

  it('is not a tap when another key, a click or Alt+Tab came in between', () => {
    const t = new AltTap()
    t.keyDown(key('Alt', { altKey: true }))
    t.keyDown(key('f', { altKey: true }))
    expect(t.keyUp(key('Alt'))).toBe(false)
    t.keyDown(key('Alt', { altKey: true }))
    t.cancel()
    expect(t.keyUp(key('Alt'))).toBe(false)
    t.keyDown(key('Alt', { altKey: true, ctrlKey: true }))
    expect(t.keyUp(key('Alt'))).toBe(false)
  })

  it('auto-repeat while Alt is held keeps it armed', () => {
    const t = new AltTap()
    t.keyDown(key('Alt', { altKey: true }))
    t.keyDown(key('Alt', { altKey: true, repeat: true }))
    expect(t.keyUp(key('Alt'))).toBe(true)
  })
})
