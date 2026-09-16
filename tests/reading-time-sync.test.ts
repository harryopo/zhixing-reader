// 知行读书 — 阅读时长同步（electron/services/reading-time-sync.ts）
//
// 背景：统计页把「阅读时长」当 KPI 展示，但 daily_stats.reading_time 永远是 0 ——
// 写入链路从未被调用过。而真值其实一直在微信读书返回的 readTimes 里
// （实测 /readdata/detail?mode=monthly 给出 { Unix秒: 秒数 }，7 天共 3252 秒）。
//
// 这里守两件事：
//   1. epoch 秒 → 日期 的换算必须准（这类转换最容易差一天）
//   2. 同步失败绝不能影响主流程（它只是顺带做的事）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

vi.mock('../electron/weread-api', () => ({
  fetchReadingData: vi.fn(),
}))

import { fetchReadingData } from '../electron/weread-api'
import { syncReadingTimeToLocal } from '../electron/services/reading-time-sync'
import { dailyStatsDb } from '../electron/database'

const mockedFetch = vi.mocked(fetchReadingData)

/** 用户真实数据里出现过的 readTimes（已核对过 epoch → 日期 的对应） */
const REAL_READ_TIMES: Record<string, number> = {
  '1788624000': 167,  // 2026-09-05
  '1788710400': 1459, // 2026-09-06
  '1788796800': 8,    // 2026-09-07
  '1788883200': 0,    // 2026-09-08（这天没读）
  '1788969600': 0,    // 2026-09-09
  '1789056000': 1600, // 2026-09-10
  '1789142400': 18,   // 2026-09-11
}

describe('syncReadingTimeToLocal', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    mockedFetch.mockReset()
  })
  afterEach(() => teardownTestDatabase())

  it('把 readTimes 按天写入 daily_stats（日期换算准确）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: REAL_READ_TIMES, totalReadTime: 3252 } as never)

    const r = await syncReadingTimeToLocal()
    expect(r.days).toBe(7)
    expect(r.totalSeconds).toBe(167 + 1459 + 8 + 0 + 0 + 1600 + 18)

    const rows = dailyStatsDb.getRange('2026-09-05', '2026-09-11')
    const byDate = new Map(rows.map((x) => [(x as any).date, (x as any).reading_time]))
    expect(byDate.get('2026-09-05')).toBe(167)
    expect(byDate.get('2026-09-06')).toBe(1459)
    expect(byDate.get('2026-09-10')).toBe(1600)
    expect(byDate.get('2026-09-11')).toBe(18)
  })

  it('值为 0 的日期同样写入（表示"这天没读"，是有效信息）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: REAL_READ_TIMES } as never)
    await syncReadingTimeToLocal()
    const rows = dailyStatsDb.getRange('2026-09-08', '2026-09-09')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => (r as any).reading_time === 0)).toBe(true)
  })

  it('重复同步覆盖而不是累加（同一天不会越加越多）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: { '1788710400': 1459 } } as never)
    await syncReadingTimeToLocal()
    await syncReadingTimeToLocal()
    const rows = dailyStatsDb.getRange('2026-09-06', '2026-09-06')
    expect((rows[0] as any).reading_time).toBe(1459)
  })

  it('只走 monthly 模式（weekly 窗口可能为空）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: {} } as never)
    await syncReadingTimeToLocal()
    expect(mockedFetch).toHaveBeenCalledWith('monthly')
  })

  it('readTimes 缺失时安全返回 0，不抛错', async () => {
    mockedFetch.mockResolvedValue({ totalReadTime: 0 } as never)
    const r = await syncReadingTimeToLocal()
    expect(r).toEqual({ days: 0, totalSeconds: 0 })
  })

  it('**接口失败时绝不抛错**（不能连累取阅读数据的主流程）', async () => {
    mockedFetch.mockRejectedValue(new Error('网络断了'))
    await expect(syncReadingTimeToLocal()).resolves.toEqual({ days: 0, totalSeconds: 0 })
  })

  it('非法的键/值被跳过，不写脏数据', async () => {
    mockedFetch.mockResolvedValue({
      readTimes: { abc: 100, '-5': 100, '1788796800': 8 } as never,
    } as never)
    const r = await syncReadingTimeToLocal()
    expect(r.days).toBe(1)
    const rows = dailyStatsDb.getRange('2026-09-07', '2026-09-07')
    expect((rows[0] as any).reading_time).toBe(8)
  })

  it('与其它每日计数并存，互不干扰', async () => {
    const today = new Date().toISOString().split('T')[0]
    dailyStatsDb.incrementCardsReviewed(3)
    mockedFetch.mockResolvedValue({
      readTimes: { [String(Math.floor(Date.now() / 1000))]: 900 },
    } as never)
    await syncReadingTimeToLocal()
    const t = dailyStatsDb.getToday() as any
    expect(t.reading_time).toBe(900)
    expect(t.cards_reviewed).toBe(3)
    expect(today).toBeTruthy()
  })
})
