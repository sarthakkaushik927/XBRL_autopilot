/**
 * The custom title bar (VS Code style): the OS title bar is hidden, Windows / Linux still draw the minimise / maximise /
 * close buttons over it (titleBarOverlay), and the renderer draws the rest: the menu names, the filing and the editor
 * toolbar. The application menu stays set, so its shortcuts keep working; clicking a menu name pops that menu up here.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, Menu } from 'electron'
import type { MenuName } from '@shared/ipc'

/** The title bar's height in CSS px; the renderer's bar uses the same (h-8). */
export const TITLE_BAR_HEIGHT = 32

/** The window-control colours: the title bar's background (--panel-2) and text (--muted) of each theme (styles.css). */
export function overlayColors(dark: boolean): { color: string; symbolColor: string; height: number } {
  return dark ? { color: '#1a1e24', symbolColor: '#e6e9ee', height: TITLE_BAR_HEIGHT } : { color: '#f0f2f5', symbolColor: '#1b1f24', height: TITLE_BAR_HEIGHT }
}

/** BrowserWindow options for the custom title bar on this platform. */
export function titleBarOptions(platform: NodeJS.Platform, dark: boolean): BrowserWindowConstructorOptions {
  // macOS: the traffic lights stay, inset into our bar; its menu is the global one at the top of the screen
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset' }
  return { titleBarStyle: 'hidden', titleBarOverlay: overlayColors(dark) }
}

/** A menu label as shown: "&File" → "File", "Company && Auditor" → "Company & Auditor". */
export function plainLabel(label: string): string {
  return label.replace(/&&|&/g, (m) => (m === '&&' ? '&' : ''))
}

/** A label's access key: "F&iling" → "i"; "&&" is a literal ampersand, not a marker. */
export function mnemonicOf(label: string): string | null {
  const m = /(?:^|[^&])(?:&&)*&([^&])/.exec(label)
  return m ? m[1]!.toLowerCase() : null
}

/** The top-level menu names, in order, with their Alt+letter. */
export function menuNames(menu: Menu | null): MenuName[] {
  return menu ? menu.items.map((i) => ({ label: plainLabel(i.label), mnemonic: mnemonicOf(i.label) })) : []
}

/**
 * Opens a top-level menu under its name in the title bar. `x` / `y` are CSS px from the renderer; the popup wants
 * window coordinates, which differ by the page zoom (Ctrl + / Ctrl -).
 */
export function popupMenu(menu: Menu | null, win: BrowserWindow | null, index: number, x: number, y: number): void {
  const submenu = menu?.items[index]?.submenu
  if (!win || !submenu) return
  const zoom = win.webContents.getZoomFactor()
  submenu.popup({ window: win, x: Math.round(x * zoom), y: Math.round(y * zoom) })
}
