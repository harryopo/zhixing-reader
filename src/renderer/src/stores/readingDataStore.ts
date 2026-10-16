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

/**
 * 阅读时长的界面写法。
 *
 * `!Number.isFinite` 那一支不是防御性摆设：微信读书返回的 `wrListenTime` 之类字段
 * 缺失或脏掉时，`NaN <= 0` 是 false、`Infinity > 0` 是 true，界面会画出「NaN分钟」
 * 或「Infinity小时」—— 2026-09-29 量到、10-04 复核仍在。这类值不能演成「0分钟」：
 * "这一次没读到数"与"这次真读了 0 秒"是两件事（与 `formatTimeAgo` 一样回 `-`）。
 */
function formatReadingTime(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-'
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
      // 失败时三件事一起做，缺一件界面上就会说错话：
      //   data 归 null —— 留着上一次的成功值，统计页会拿旧数字当这一次的结果画出来，
      //     而界面上只挂一行错误，两句都在说谎；
      //   mode 写成 targetMode —— 用户点的档位就是问出去的档位，选中态不许停在别的档上；
      //   loading 归 false —— 不然界面一直转。
      set({ data: null, mode: targetMode, error: (error as Error).message, loading: false })
    }
  },

  setMode: (mode: ReadingMode) => {
    set({ mode })
    get().fetchReadingData(mode)
  },
}))
