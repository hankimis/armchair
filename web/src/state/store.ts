import { create } from 'zustand'
import type { HandStatus } from '../lib/hand'
import type { PolicyStatus } from '../lib/policy'
import { DEFAULT_TASK, type Episode } from '../lib/sim'
import type { RobotStatus } from '../lib/ws'

const STORAGE_KEY = 'armchair.episodes.v1'

function loadEpisodes(): Episode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(episodes: Episode[]) {
  try {
    // image frames are far beyond localStorage quota — persist state streams only
    const slim = episodes.map(({ images: _images, ...rest }) => rest)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch (err) {
    console.warn('episode persistence failed (storage quota?)', err)
  }
}

interface Store {
  episodes: Episode[]
  recording: boolean
  playingId: string | null
  robot: RobotStatus
  task: string
  handEnabled: boolean
  handStatus: HandStatus
  policyStatus: PolicyStatus
  policyName: string
  addEpisode: (ep: Episode) => void
  removeEpisode: (id: string) => void
  toggleSuccess: (id: string) => void
  clearEpisodes: () => void
  setRecording: (v: boolean) => void
  setPlayingId: (id: string | null) => void
  setRobot: (s: RobotStatus) => void
  setTask: (t: string) => void
  setHandEnabled: (v: boolean) => void
  setHandStatus: (s: HandStatus) => void
  setPolicy: (s: PolicyStatus, name?: string) => void
}

export const useStore = create<Store>((set) => ({
  episodes: loadEpisodes(),
  recording: false,
  playingId: null,
  robot: 'off',
  task: DEFAULT_TASK,
  handEnabled: false,
  handStatus: 'off',
  policyStatus: 'none',
  policyName: '',
  addEpisode: (ep) =>
    set((s) => {
      const episodes = [...s.episodes, ep]
      persist(episodes)
      return { episodes }
    }),
  removeEpisode: (id) =>
    set((s) => {
      const episodes = s.episodes.filter((e) => e.id !== id)
      persist(episodes)
      return { episodes }
    }),
  toggleSuccess: (id) =>
    set((s) => {
      const episodes = s.episodes.map((e) => (e.id === id ? { ...e, success: !e.success } : e))
      persist(episodes)
      return { episodes }
    }),
  clearEpisodes: () =>
    set(() => {
      persist([])
      return { episodes: [] }
    }),
  setRecording: (recording) => set({ recording }),
  setPlayingId: (playingId) => set({ playingId }),
  setRobot: (robot) => set({ robot }),
  setTask: (task) => set({ task }),
  setHandEnabled: (handEnabled) => set(handEnabled ? { handEnabled } : { handEnabled, handStatus: 'off' }),
  setHandStatus: (handStatus) => set({ handStatus }),
  setPolicy: (policyStatus, policyName) =>
    set((s) => ({ policyStatus, policyName: policyName ?? s.policyName })),
}))
