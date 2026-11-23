import { FileSpreadsheet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MenuName } from '@shared/ipc'
import { useSidecar } from '@/stores/sidecar'
import { EditorToolbar } from './EditorToolbar'
import { AltTap, letterIndex, mnemonicIndex, mnemonicPosition } from './menu-keys'
import { useWorkspace } from './workspace'

/** Room the OS window buttons take at the right (Windows / Linux) when the browser can't say (titlebar-area env). */
const CONTROLS_FALLBACK_PX = 138

/**
 * VS Code-style title bar (main: title-bar.ts): menu names, the open filing and the editor toolbar (auto-save, Save,
 * layout toggles) in one row. The bar drags the window and double-clicking it maximises; the OS draws the window buttons.
 */
export function TitleBar() {
  const platform = useSidecar((s) => s.app?.platform)
  const mac = platform === 'darwin'
  const ws = useWorkspace()
  const dirty = ws?.saveState === 'Unsaved changes' || ws?.saveState === 'Not saved yet'
  const title = ws ? `${ws.header.company} · ${ws.header.fyLabel}` : 'XBRL Autopilot'
  return (
    <header
      className="xap-drag flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel-2 text-xs"
      // keep clear of the window buttons: macOS's on the left, the others' on the right
      style={mac ? { paddingLeft: 76 } : { paddingRight: `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - ${CONTROLS_FALLBACK_PX}px)))` }}
      data-testid="title-bar"
    >
      {!mac && (
        <>
          <FileSpreadsheet size={15} strokeWidth={1.75} className="mx-2.5 shrink-0 text-accent" aria-hidden />
          <MenuNames />
        </>
      )}
      <div className="min-w-0 flex-1 truncate px-3 text-center text-muted" title={title} data-testid="title-bar-title">
        {dirty && <span className="mr-1 text-warn" aria-label="Unsaved changes">●</span>}
        {title}
      </div>
      <div className="xap-no-drag shrink-0">
        <EditorToolbar />
      </div>
    </header>
  )
}

/**
 * File, Edit, View…: each opens the application menu's own submenu (the same menu, with its shortcuts). Keyboard as on
 * Windows: Alt+letter opens a menu; a lone Alt tap enters the bar (letters underlined), ←/→ move, Enter/↓ open, Esc leaves.
 */
function MenuNames() {
  const names = useMenuNames()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [altHeld, setAltHeld] = useState(false)
  const [inBar, setInBar] = useState(false)

  const open = useCallback((i: number) => {
    const b = buttons.current[i]
    if (!b) return
    const r = b.getBoundingClientRect()
    b.blur()
    setInBar(false)
    void window.xap?.menu.popup(i, r.left, r.bottom)
  }, [])

  // window-wide, in the capture phase: Alt+F must reach the menu even from the grid or the XML editor
  useEffect(() => {
    const tap = new AltTap()
    const down = (e: KeyboardEvent) => {
      tap.keyDown(e)
      if (e.key === 'Alt') setAltHeld(true)
      const i = mnemonicIndex(names, e)
      if (i < 0) return
      e.preventDefault()
      e.stopPropagation()
      setAltHeld(false)
      open(i)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false)
      if (!tap.keyUp(e)) return
      e.preventDefault()
      const inside = buttons.current.includes(document.activeElement as HTMLButtonElement)
      if (inside) return (document.activeElement as HTMLElement).blur()
      buttons.current[0]?.focus()
      setInBar(true)
    }
    const cancel = () => {
      tap.cancel()
      setAltHeld(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [names, open])

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const move = (to: number) => buttons.current[(to + names.length) % names.length]?.focus()
    if (e.key === 'ArrowRight') move(i + 1)
    else if (e.key === 'ArrowLeft') move(i - 1)
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') open(i)
    else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur()
    else {
      const j = e.altKey ? -1 : letterIndex(names, e.key)
      if (j < 0) return
      open(j)
    }
    e.preventDefault()
  }

  const underline = altHeld || inBar
  return (
    <nav
      className="xap-no-drag flex shrink-0 items-center"
      aria-label="Menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInBar(false)
      }}
    >
      {names.map((n, i) => (
        <button
          key={n.label}
          ref={(el) => {
            buttons.current[i] = el
          }}
          className="h-6 rounded px-2 text-fg/90 outline-none hover:bg-panel hover:text-fg focus-visible:bg-panel focus-visible:text-fg focus-visible:ring-1 focus-visible:ring-accent"
          onClick={() => open(i)}
          onKeyDown={(e) => onKeyDown(e, i)}
          aria-keyshortcuts={n.mnemonic ? `Alt+${n.mnemonic.toUpperCase()}` : undefined}
          data-testid={`menu-${n.label.toLowerCase()}`}
        >
          <Label name={n} underline={underline} />
        </button>
      ))}
    </nav>
  )
}

/** "Filing" with its access key underlined while Alt is held or the bar has the focus. */
function Label({ name, underline }: { name: MenuName; underline: boolean }) {
  const at = mnemonicPosition(name)
  if (!underline || at < 0) return <>{name.label}</>
  return (
    <>
      {name.label.slice(0, at)}
      <span className="underline underline-offset-2" data-testid="mnemonic">
        {name.label[at]}
      </span>
      {name.label.slice(at + 1)}
    </>
  )
}

function useMenuNames(): MenuName[] {
  const [names, setNames] = useState<MenuName[]>([])
  useEffect(() => {
    let live = true
    void window.xap?.menu.labels().then((l) => live && setNames(l))
    return () => {
      live = false
    }
  }, [])
  return names
}
