/**
 * Background work in flight (IPC calls to main and the backend), so the window can show that something is running
 * even when no screen asks for it (PR #15 review: "every asynchronous operation should provide loading feedback").
 * `unwrap` tracks every call; the thin progress line under the title reads `pending`.
 */
import { create } from 'zustand'

interface ActivityState {
  /** calls in flight */
  pending: number
  track<T>(work: Promise<T>): Promise<T>
}

export const useActivity = create<ActivityState>((set, get) => ({
  pending: 0,
  track: async (work) => {
    set({ pending: get().pending + 1 })
    try {
      return await work
    } finally {
      set({ pending: Math.max(0, get().pending - 1) })
    }
  },
}))
