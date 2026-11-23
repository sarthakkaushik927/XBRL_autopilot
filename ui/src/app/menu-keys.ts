/**
 * Alt-key menu access for the custom title bar (Windows behaviour, as in VS Code):
 * - Alt+F, Alt+E, … opens the menu with that access key;
 * - tapping Alt on its own (pressed and released with nothing in between) enters the menu bar.
 * Pure: the title bar feeds it key events.
 */
import type { MenuName } from '@shared/ipc'

type Keys = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

/** The menu an Alt+letter opens; -1 when none (other shortcuts, AltGr = Ctrl+Alt, Alt+Shift…). */
export function mnemonicIndex(names: MenuName[], e: Keys): number {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1
  return letterIndex(names, e.key)
}

/** The menu a plain letter opens while the menu bar has the focus; -1 when none. */
export function letterIndex(names: MenuName[], key: string): number {
  if (key.length !== 1) return -1
  const k = key.toLowerCase()
  return names.findIndex((n) => n.mnemonic === k)
}

/** Where the access key is in the shown label ("Filing", "i" → 1), to underline it; -1 when it isn't there. */
export function mnemonicPosition(name: MenuName): number {
  return name.mnemonic ? name.label.toLowerCase().indexOf(name.mnemonic) : -1
}

/** Detects a lone Alt tap: Alt down, then Alt up with no other key, click or focus loss in between (Alt+Tab). */
export class AltTap {
  private armed = false

  keyDown(e: Keys & { repeat?: boolean }): void {
    if (e.repeat) return
    this.armed = e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey
  }

  /** true when this key-up completes a lone tap */
  keyUp(e: Pick<KeyboardEvent, 'key'>): boolean {
    const tap = this.armed && e.key === 'Alt'
    this.armed = false
    return tap
  }

  /** a click or the window losing focus: whatever Alt was doing, it was not a tap */
  cancel(): void {
    this.armed = false
  }
}
