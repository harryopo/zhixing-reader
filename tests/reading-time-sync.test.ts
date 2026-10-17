// 知行读书 — 阅读时长同步（electron/services/reading-time-sync.ts）
//
// 背景：统计页把「阅读时长」当 KPI 展示，但 daily_stats.reading_time 永远是 0 ——
// 写入链路从未被调用过。而真值其实一直在微信读书返回的 readTimes 里
// （实测 /readdata/detail?mode=monthly 给出 { Unix秒: 秒数 }，7 天共 3252 秒）。
//
// 这里守三件事：
//   1. epoch 秒 → 日期 的换算必须准（这类转换最容易差一天 —— 而且这次真的差了一天）
//   2. 同步失败绝不能影响主流程（它只是顺带做的事）
//   3. 写入的键必须与界面读的那把尺同源（本地日，见 src/shared/db-time.ts 的 localDayKey）
//
// ⚠️ 2026-10-17 更正：本文件此前把 **缺陷当成了期望**。微信读书 readTimes 的 epoch 是
// **北京零点**（1788624000 % 86400 = 57600 = 16:00 UTC，七个键全是同一时刻），
// 而旧实现取 `toISOString().split('T')[0]` = UTC 日 ⇒ 每一天的阅读时长整体挂在前一天的键上。
// 旧断言 `byDate.get('2026-09-05') === 167` 量的正是那个错位。现在按来源真实日钉。
// TZ 必须钉住：不钉的话，UTC runner 上"本地日"就等于 UTC 日，这份判据在 CI 上会自证清白。
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

vi.mock('../electron/weread-api', () => ({
  fetchReadingData: vi.fn(),
}))

import { fetchReadingData } from '../electron/weread-api'
import { syncReadingTimeToLocal } from '../electron/services/reading-time-sync'
import { dailyStatsDb } from '../electron/database'
import { localDayKey } from '../src/shared/db-time'

const mockedFetch = vi.mocked(fetchReadingData)

/**
 * 用户真实数据里出现过的 readTimes。
 * 每个 epoch 都是**北京零点**（= 16:00 UTC 前一天），所以真实日比旧实现算出来的大一格。
 */
const REAL_READ_TIMES: Record<string, number> = {
  '1788624000': 167,  // 北京 2026-09-06
  '1788710400': 1459, // 北京 2026-09-07
  '1788796800': 8,    // 北京 2026-09-08
  '1788883200': 0,    // 北京 2026-09-09（这天没读）
  '1788969600': 0,    // 北京 2026-09-10
  '1789056000': 1600, // 北京 2026-09-11
  '1789142400': 18,   // 北京 2026-09-12
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

    const rows = dailyStatsDb.getRange('2026-09-06', '2026-09-12')
    const byDate = new Map(rows.map((x) => [(x as any).date, (x as any).reading_time]))
    expect(byDate.get('2026-09-06')).toBe(167)
    expect(byDate.get('2026-09-07')).toBe(1459)
    expect(byDate.get('2026-09-11')).toBe(1600)
    expect(byDate.get('2026-09-12')).toBe(18)
  })

  it('量具自检：TZ 真的钉在东八区（没钉住上面那三条就是在自证清白）', () => {
    expect(new Date(1788624000 * 1000).getHours()).toBe(0)
    expect(new Date(1788624000 * 1000).getDate()).toBe(6)
  })

  it('换算与界面读的那把尺同一个口径（localDayKey）', async () => {
    const epoch = 1788624000
    mockedFetch.mockResolvedValue({ readTimes: { [String(epoch)]: 167 } } as never)
    await syncReadingTimeToLocal()

    const expected = localDayKey(new Date(epoch * 1000))
    const rows = dailyStatsDb.getRange(expected, expected)
    expect(rows, `写入的键不是 localDayKey 说的那一天（期望 ${expected}）`).toHaveLength(1)
    expect((rows[0] as any).reading_time).toBe(167)
  })

  it('值为 0 的日期同样写入（表示"这天没读"，是有效信息）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: REAL_READ_TIMES } as never)
    await syncReadingTimeToLocal()
    const rows = dailyStatsDb.getRange('2026-09-09', '2026-09-10')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => (r as any).reading_time === 0)).toBe(true)
  })

  it('重复同步覆盖而不是累加（同一天不会越加越多）', async () => {
    mockedFetch.mockResolvedValue({ readTimes: { '1788710400': 1459 } } as never)
    await syncReadingTimeToLocal()
    await syncReadingTimeToLocal()
    const rows = dailyStatsDb.getRange('2026-09-07', '2026-09-07')
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
    const rows = dailyStatsDb.getRange('2026-09-08', '2026-09-08')
    expect((rows[0] as any).reading_time).toBe(8)
  })

  it('与其它每日计数并存，互不干扰', async () => {
    dailyStatsDb.incrementCardsReviewed(3)
    mockedFetch.mockResolvedValue({
      readTimes: { [String(Math.floor(Date.now() / 1000))]: 900 },
    } as never)
    await syncReadingTimeToLocal()
    const t = dailyStatsDb.getToday() as any
    // 写进去的那一天与读出来的必须是同一个键 —— 同步与当场计数不许各挂一个日子
    expect(t.date).toBe(localDayKey(new Date()))
    expect(t.reading_time).toBe(900)
    expect(t.cards_reviewed).toBe(3)
  })
})
