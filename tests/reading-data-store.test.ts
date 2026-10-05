// @vitest-environment happy-dom
//
// readingDataStore 状态与通路测试 —— Issue #8 的真实剩余部分
//
// Issue #8 写的是「两个 store 零测试引用」，但那条已被 2026-09-27 那批部分还清：
// `settingsStore` 现有 `tests/settings-store-state.test.ts` 37 条 + 两个接线用例。
// 真正零测试的是本文件这个 —— 45 行、两个方法，被统计页四张图表一个纯函数引用。
//
// 判据与另两份 store 测试同一路：mock 只打在 `window.electronAPI`
// （渲染层与主进程之间唯一的边界），取数、错误处理、模式切换全部走 store 自己的代码。
// 每个用例重新 import 一份干净的 store —— 它是模块级单例，不清的话上一组留下的
// `data` / `error` 会漏进下一条，而「读失败后界面显示什么」正好要靠初值说清。
//
// 期望先想清楚再写（Issue #8 的硬要求）：
//   - 读到数据 ⇒ `data` 是那一份、`loading` 归 false、`error` 清空；
//   - 读到失败 ⇒ `error` 是那句消息、`loading` 归 false，且 **`data` 归 `null`** ——
//     留着上一次的成功值会让统计页拿旧数据当这一次的结果画出来，而界面上只挂一行
//     错误。这与本项目反复治的「把失败演成没有数据」是同一种病（那是 tenth 次）。
//   - `setMode` 只换 mode 并触发一次重取，参数是**新**的 mode；
//   - `formatReadingTime` 是纯函数，四档边界逐个钉住。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReadingDataResponse, ReadingMode } from '../src/shared/types'

type StoreModule = typeof import('../src/renderer/src/stores/readingDataStore')

const fetchMock = vi.fn()

/** 重新 import 一份干净的 store（连带清掉模块级单例的旧 data / error） */
async function freshStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('../src/renderer/src/stores/readingDataStore')
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 一份"读到了"的响应：字段照 `ReadingDataResponse` 逐个给，不是随手一个对象 */
function reading(over: Partial<ReadingDataResponse> = {}): ReadingDataResponse {
  return {
    baseTime: 1_700_000_000,
    readTimes: { '2026-09-01': 1800 },
    dailyReadTimes: { '2026-09-01': 1800 },
    readDays: 7,
    totalReadTime: 7200,
    dayAverageReadTime: 1028,
    ...over,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  ;(globalThis as unknown as { window: unknown }).window = {
    electronAPI: { readingData: { fetch: fetchMock } },
  }
})

describe('readingDataStore · 取数', () => {
  it('默认 mode 是 monthly（界面上第一眼看到的那一档）', async () => {
    const { useReadingDataStore } = await freshStore()
    expect(useReadingDataStore.getState().mode).toBe('monthly')
  })

  it('读到数据后交出那一份，loading 归 false，error 清空', async () => {
    const data = reading()
    fetchMock.mockResolvedValue(data)
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData()
    const s = useReadingDataStore.getState()

    expect(s.data).toEqual(data)
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('取数过程中 loading 真的为 true（不是取完了才变）', async () => {
    let release: (v: ReadingDataResponse) => void = () => {}
    fetchMock.mockReturnValue(new Promise<ReadingDataResponse>((r) => (release = r)))
    const { useReadingDataStore } = await freshStore()

    const running = useReadingDataStore.getState().fetchReadingData()
    expect(useReadingDataStore.getState().loading).toBe(true)

    release(reading())
    await running
    expect(useReadingDataStore.getState().loading).toBe(false)
  })

  it.each(['weekly', 'monthly', 'annually', 'overall'] as ReadingMode[])(
    '显式传 %s 时按它去问',
    async (mode) => {
      fetchMock.mockResolvedValue(reading())
      const { useReadingDataStore } = await freshStore()

      await useReadingDataStore.getState().fetchReadingData(mode)

      expect(fetchMock.mock.calls[0][0]).toBe(mode)
      expect(useReadingDataStore.getState().mode).toBe(mode)
    },
  )

  it('没传 mode 时沿用当前那一份，不问第二次', async () => {
    fetchMock.mockResolvedValue(reading())
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData('weekly')
    fetchMock.mockClear()
    await useReadingDataStore.getState().fetchReadingData()

    expect(fetchMock.mock.calls[0][0]).toBe('weekly')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('baseTime 传下去时不许被吞掉', async () => {
    fetchMock.mockResolvedValue(reading())
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData('monthly', 1_700_000_000)

    expect(fetchMock.mock.calls[0]).toEqual(['monthly', 1_700_000_000])
  })

  it('反证 · 不传 baseTime 时第二个参数就是 undefined（不是 0，那会被当成真时刻）', async () => {
    fetchMock.mockResolvedValue(reading())
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData('monthly')

    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
  })
})

describe('readingDataStore · 读失败不许留着上一次的数据', () => {
  it('先读到一次成功，再失败 ⇒ error 有话说、data 归 null', async () => {
    fetchMock.mockResolvedValueOnce(reading({ totalReadTime: 7200 }))
    const { useReadingDataStore } = await freshStore()
    await useReadingDataStore.getState().fetchReadingData('monthly')
    expect(useReadingDataStore.getState().data?.totalReadTime).toBe(7200)

    fetchMock.mockRejectedValueOnce(new Error('网络断了'))
    await useReadingDataStore.getState().fetchReadingData('monthly')

    const s = useReadingDataStore.getState()
    // 这是本文件最要紧的一条：留着旧值的话，统计页会拿上一次的成功结果当这一次画出来，
    // 而界面上只有一行错误 —— 用户看到的是"这次的数据"加一句读失败，两句都在说谎。
    expect(s.data).toBeNull()
    expect(s.error).toBe('网络断了')
    expect(s.loading).toBe(false)
  })

  it('失败之后 mode 只在问到的那一档上改：问 weekly 却还停在 monthly 就是问错了', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData('weekly')

    // 初值是 monthly。用户点了「本周」，即使这一次读失败，界面选中的也该是「本周」——
    // 否则按钮显示月度、而问出去的是本周，界面上那个选中态在说假话。
    // （第一次写这条时我期望的是"mode 仍是对的那一档"并断言 weekly，当场红：
    //  代码只在成功那支写 mode，失败时压根没写 —— 这条期望本来就该是 weekly。）
    expect(useReadingDataStore.getState().mode).toBe('weekly')
  })

  it('下一次读到成功时 error 被清掉，不粘着上一条的错误', async () => {
    fetchMock.mockRejectedValueOnce(new Error('网络断了'))
    const { useReadingDataStore } = await freshStore()
    await useReadingDataStore.getState().fetchReadingData('monthly')
    expect(useReadingDataStore.getState().error).toBe('网络断了')

    fetchMock.mockResolvedValueOnce(reading())
    await useReadingDataStore.getState().fetchReadingData('monthly')

    expect(useReadingDataStore.getState().error).toBeNull()
    expect(useReadingDataStore.getState().data).not.toBeNull()
  })

  it('主进程交回的不是对象（undefined / 字符串）时不许把那种东西当数据摆出去', async () => {
    // 真库/IPC 交回的形状不对时，界面拿到一个非对象就会在渲染时炸；
    // 这里量的是"现在会炸"，修法另开一批，别把测试写成假设的样子。
    fetchMock.mockResolvedValueOnce(undefined)
    const { useReadingDataStore } = await freshStore()

    await useReadingDataStore.getState().fetchReadingData('monthly')

    // 与 db-mapper 那批同一口径：真值自己声明自己是不是"没有"，不做二次猜测
    expect(useReadingDataStore.getState().data ?? null).toBeNull()
  })
})

describe('readingDataStore · setMode', () => {
  it('换档位会真的重取一次，且问的是新档位', async () => {
    fetchMock.mockResolvedValue(reading())
    const { useReadingDataStore } = await freshStore()

    useReadingDataStore.getState().setMode('annually')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('annually')
    expect(useReadingDataStore.getState().mode).toBe('annually')
  })

  it('mode 立刻就换了，不等取数回来（界面上的时段按钮不该等网络）', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { useReadingDataStore } = await freshStore()

    useReadingDataStore.getState().setMode('overall')

    expect(useReadingDataStore.getState().mode).toBe('overall')
  })

  it('切档位时 loading 归 true —— 否则界面看不出正在换', async () => {
    let release: (v: ReadingDataResponse) => void = () => {}
    fetchMock.mockReturnValue(new Promise<ReadingDataResponse>((r) => (release = r)))
    const { useReadingDataStore } = await freshStore()

    useReadingDataStore.getState().setMode('weekly')
    expect(useReadingDataStore.getState().loading).toBe(true)

    release(reading())
    await flush()
    expect(useReadingDataStore.getState().loading).toBe(false)
  })

  it('切档位读失败时 data 也归 null（不清的话上一次那档的数字会顶在新档位上）', async () => {
    fetchMock.mockResolvedValueOnce(reading({ totalReadTime: 999 }))
    const { useReadingDataStore } = await freshStore()
    await useReadingDataStore.getState().fetchReadingData('monthly')

    fetchMock.mockRejectedValueOnce(new Error('网络断了'))
    useReadingDataStore.getState().setMode('weekly')
    await flush()

    expect(useReadingDataStore.getState().data).toBeNull()
    expect(useReadingDataStore.getState().mode).toBe('weekly')
  })
})

describe('formatReadingTime · 四档边界', () => {
  it.each([
    // 0 与负数都收成「0分钟」：这条函数是显示层的人话化，不往界面上摆负数
    [0, '0分钟'],
    [-1, '0分钟'],
    // ⚠️ 30 秒 → 「0分钟」是**既有行为**，不是缺陷：不足一分钟就是说 0 分钟。
    //   第一次写这条时我期望 "30分钟"，当场红 —— 那是我的期望错，不是代码错
    //   （Issue #8 的硬要求：红了先判断是哪一边错，再决定改哪边）。
    [30, '0分钟'],
    [59 * 60, '59分钟'],
    [60 * 60, '1小时'],
    [60 * 60 + 60, '1小时1分钟'],
    [2 * 3600 + 30 * 60, '2小时30分钟'],
    [3600 * 24, '24小时'],
  ])('%i 秒 ⇒ %s', async (seconds, expected) => {
    const { formatReadingTime } = await freshStore()
    expect(formatReadingTime(seconds)).toBe(expected)
  })

  // NaN 那条不在这里 —— 它是"脏数据不许直接显示"的另一件事（与 db-mapper 那批同一口径），
  // 该配自己的判据与修法，不该借这次改人话函数的期望混进来。
})
