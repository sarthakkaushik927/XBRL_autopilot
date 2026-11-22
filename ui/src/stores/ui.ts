import { create } from 'zustand'

export type Activity = 'explorer' | 'taxonomy' | 'problems' | 'ai' | 'masters' | 'settings'
export type RightTab = 'form' | 'xml' | 'preview'
export type BottomTab = 'problems' | 'ai' | 'output'

/** Which panels are shown: remembered per user across restarts (a view preference, not filing data). */
export interface Layout {
  sidebarOpen: boolean
  bottomOpen: boolean
}

export const LAYOUT_KEY = 'xap.layout'
const DEFAULT_LAYOUT: Layout = { sidebarOpen: true, bottomOpen: true }

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>

/** The remembered layout; the default when nothing (or nothing readable) is stored. */
export function loadLayout(storage: KeyValue | undefined): Layout {
  try {
    const raw = storage?.getItem(LAYOUT_KEY)
    const v = raw ? (JSON.parse(raw) as Partial<Layout>) : {}
    return {
      sidebarOpen: typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : DEFAULT_LAYOUT.sidebarOpen,
      bottomOpen: typeof v.bottomOpen === 'boolean' ? v.bottomOpen : DEFAULT_LAYOUT.bottomOpen,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(storage: KeyValue | undefined, layout: Layout): void {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // storage full or blocked: the layout just isn't remembered
  }
}

const storage = (): KeyValue | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)

interface UiState extends Layout {
  activity: Activity
  rightTab: RightTab
  bottomTab: BottomTab
  setActivity(a: Activity): void
  /** shows an activity's side panel (never collapses it, unlike clicking the activity bar) */
  showActivity(a: Activity): void
  toggleSidebar(): void
  toggleBottom(): void
  setRightTab(t: RightTab): void
  setBottomTab(t: BottomTab): void
}

export const useUi = create<UiState>((set, get) => {
  /** a layout change, remembered */
  const layout = (patch: Partial<Layout>) => {
    set(patch)
    saveLayout(storage(), { sidebarOpen: get().sidebarOpen, bottomOpen: get().bottomOpen })
  }
  return {
    ...loadLayout(storage()),
    activity: 'explorer',
    rightTab: 'form',
    bottomTab: 'output',
    // Clicking the active activity collapses the side panel (VS Code behaviour).
    setActivity: (a) => {
      if (get().activity === a && get().sidebarOpen) return layout({ sidebarOpen: false })
      set({ activity: a })
      layout({ sidebarOpen: true })
    },
    showActivity: (a) => {
      set({ activity: a })
      if (!get().sidebarOpen) layout({ sidebarOpen: true })
    },
    toggleSidebar: () => layout({ sidebarOpen: !get().sidebarOpen }),
    toggleBottom: () => layout({ bottomOpen: !get().bottomOpen }),
    setRightTab: (rightTab) => set({ rightTab }),
    // showing a tab (Problems after Generate, a status-bar click) opens the panel
    setBottomTab: (bottomTab) => {
      set({ bottomTab })
      if (!get().bottomOpen) layout({ bottomOpen: true })
    },
  }
})
