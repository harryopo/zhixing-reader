import { create } from 'zustand'
import { ReadingDataResponse, ReadingMode } from '../../../shared/types'

interface ReadingDataState {
  data: ReadingDataResponse | null
  mode: ReadingMode
  loading: boolean
  error: string | null
  fetchReadingData: (mode?: ReadingMode, baseTime?: number) => Promise<void>
  setMode: (mode: ReadingMode) => void
}

function formatReadingTime(seconds: number): string {
  if (seconds <= 0) return '0分钟'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours}小时${minutes}分钟`
  if (hours > 0) return `${hours}小时`
  return `${minutes}分钟`
}

export { formatReadingTime }

export const useReadingDataStore = create<ReadingDataState>((set, get) => ({
  data: null,
  mode: 'monthly',
  loading: false,
  error: null,

  fetchReadingData: async (mode?: ReadingMode, baseTime?: number) => {
    set({ loading: true, error: null })
    const targetMode = mode || get().mode
    try {
      const data = await window.electronAPI.readingData.fetch(targetMode, baseTime) as ReadingDataResponse
      set({ data, mode: targetMode, loading: false })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  setMode: (mode: ReadingMode) => {
    set({ mode })
    get().fetchReadingData(mode)
  },
}))
