import { describe, expect, it } from 'vitest'
import { menuNames, mnemonicOf, overlayColors, plainLabel, titleBarOptions } from '../electron/main/title-bar'

describe('custom title bar', () => {
  it('shows menu names without their access-key markers', () => {
    expect(plainLabel('&File')).toBe('File')
    expect(plainLabel('F&iling')).toBe('Filing')
    expect(plainLabel('Company && Auditor Details…')).toBe('Company & Auditor Details…')
    expect(menuNames({ items: [{ label: '&File' }, { label: 'F&iling' }] } as never)).toEqual([
      { label: 'File', mnemonic: 'f' },
      { label: 'Filing', mnemonic: 'i' },
    ])
    expect(menuNames(null)).toEqual([])
  })

  it('finds the access key; a doubled && is an ampersand, not a key', () => {
    expect(mnemonicOf('&Help')).toBe('h')
    expect(mnemonicOf('Company && &Auditor')).toBe('a')
    expect(mnemonicOf('Company && Auditor')).toBeNull()
    expect(mnemonicOf('Plain')).toBeNull()
  })

  it('hides the OS title bar; Windows keeps its buttons, coloured like the bar in each theme', () => {
    expect(titleBarOptions('win32', true)).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: overlayColors(true) })
    expect(titleBarOptions('darwin', false)).toEqual({ titleBarStyle: 'hiddenInset' })
    expect(overlayColors(false).color).not.toBe(overlayColors(true).color)
    expect(overlayColors(true).height).toBe(32)
  })
})
