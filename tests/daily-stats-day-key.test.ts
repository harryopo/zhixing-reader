/**
 * 「今天到底是哪一天」的口径判据（2026-10-17）
 *
 * 病（当轮实测，不是推测）：
 *  - `daily_stats.date` 这一列是**日历日键**，界面按**本地日**读它 ——
 *    `src/shared/reading-trend.ts` 的 `recentDayKeys` 与 `profile-stats.ts` 的 `localDateStr`
 *    两边都写着同一句注释：「用 toISOString 会在 UTC+8 的凌晨把今天算成昨天」。
 *  - 而**写入侧四个方法**（getToday / incrementBooksRead / incrementHighlightsAdded /
 *    incrementCardsReviewed）全部用 `new Date().toISOString().split('T')[0]`，那是 **UTC 日**。
 *  ⇒ 本机 UTC+8：每天 00:00–08:00 的划线、复习、读完一本书，都记进**昨天那一格**。
 *
 * 更硬的一条来自微信读书的数据本身：`/readdata/detail` 返回的 readTimes 键是
 * **北京零点**的 epoch（实测 1788624000 % 86400 = 57600 = 16:00 UTC），
 * 而旧换算 `toISOString()` 取日 ⇒ **每一天的阅读时长整体被记到前一天**，
 * 不是凌晨那几小时的边角问题，是整条序列差一天。
 *
 * 所以这里的判据全部把时刻钉在**本地日的边界两侧**，而不是只看"有没有写进去"。
 */
// TZ 必须在任何 Date 取值之前钉住；下面第一条判据自检它真的生效了
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

vi.mock('../electron/weread-api', () => ({
  fetchAllContent: vi.fn(),
  fetchReadingData: vi.fn(),
}))
const mockSettings = new Map<string, unknown>()
vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    get: (k: string) => mockSettings.get(k),
    set: (k: string, v: unknown) => {
      mockSettings.set(k, v)
    },
    getAll: () => Object.fromEntries(mockSettings),
  },
}))

import { dailyStatsDb, tokenUsageDb } from '../electron/database'
import { getDatabase } from '../electron/database/connection'
import { localDayKey, dayKeyOfStoredTime } from '../src/shared/db-time'
import { runStartupRepair } from '../electron/services/startup-repair'
import { fetchReadingData } from '../electron/weread-api'

const mockedReading = vi.mocked(fetchReadingData)

/** 北京 2026-10-17 00:30（= UTC 2026-10-16 16:30）：旧口径会把这一笔写成 10-16 */
const JUST_AFTER_LOCAL_MIDNIGHT = '2026-10-16T16:30:00.000Z'
/** 北京 2026-10-16 23:30（= UTC 2026-10-16 15:30）：两种口径在这里一致，用来防"改反了" */
const JUST_BEFORE_LOCAL_MIDNIGHT = '2026-10-16T15:30:00.000Z'

function readRow(date: string): Record<string, unknown> | undefined {
  return dailyStatsDb.getRange(date, date)[0]
}

describe('量具自检：时区真的钉住了', () => {
  it('北京零点那一刻的本地小时必须是 0（TZ 没生效就别拿下面的判据下结论）', () => {
    expect(new Date('2026-09-05T16:00:00Z').getHours()).toBe(0)
    expect(new Date('2026-09-05T15:59:59Z').getHours()).toBe(23)
  })
})

describe('localDayKey / dayKeyOfStoredTime：一份口径', () => {
  it('本地日键在零点两侧各归各的一天', () => {
    expect(localDayKey(new Date(JUST_AFTER_LOCAL_MIDNIGHT))).toBe('2026-10-17')
    expect(localDayKey(new Date(JUST_BEFORE_LOCAL_MIDNIGHT))).toBe('2026-10-16')
  })

  it('库里那种"日期 空格 时间"的 UTC 串，按它真是的时刻换成本地日', () => {
    // '2026-10-16 16:30:00' 是 datetime('now') 的形状 = UTC 墙上时钟 = 北京 10-17 00:30
    expect(dayKeyOfStoredTime('2026-10-16 16:30:00')).toBe('2026-10-17')
    // 带 Z 的 ISO（ts-fsrs 那一路）照它自己声明的时区走
    expect(dayKeyOfStoredTime('2026-10-16T16:30:00.000Z')).toBe('2026-10-17')
  })

  it('认不出来的值一律 null —— 不猜 1970、不把脏值画成一个日期', () => {
    expect(dayKeyOfStoredTime('')).toBeNull()
    expect(dayKeyOfStoredTime(undefined)).toBeNull()
    expect(dayKeyOfStoredTime(null)).toBeNull()
    expect(dayKeyOfStoredTime(0)).toBeNull()
    expect(dayKeyOfStoredTime('不是日期')).toBeNull()
    expect(dayKeyOfStoredTime({})).toBeNull()
  })
})

describe('daily_stats 的写入按本地日落键', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    mockSettings.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(JUST_AFTER_LOCAL_MIDNIGHT))
  })
  afterEach(() => {
    vi.useRealTimers()
    teardownTestDatabase()
  })

  it('北京 00:30 复习三张卡 ⇒ 记在 10-17 那一格（旧口径记到 10-16）', () => {
    dailyStatsDb.incrementCardsReviewed(3)

    expect(readRow('2026-10-17')?.cards_reviewed, '凌晨的复习没落到今天那一格').toBe(3)
    expect(readRow('2026-10-16'), '旧口径的 UTC 日键还在写').toBeUndefined()
  })

  it('同一时刻 getToday() 读的就是刚写那一行（写与读必须同一个键）', () => {
    dailyStatsDb.incrementHighlightsAdded(2)

    const today = dailyStatsDb.getToday()
    expect(today?.date, '写进去是 10-17、读到的却是别的键 ⇒ 两半各说一套').toBe('2026-10-17')
    expect(today?.highlights_added).toBe(2)
  })

  it('读完一本书同样按本地日', () => {
    dailyStatsDb.incrementBooksRead()
    expect(readRow('2026-10-17')?.books_read).toBe(1)
  })
})

describe('token_usage 按同一把尺归日（窗口键是本地日，SQL 不许按 UTC 日切）', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })
  afterEach(() => teardownTestDatabase())

  /** 造一笔"北京 10-17 早上 7:00"发生的用量：库里那一列存的是 UTC 墙上时钟 */
  async function seedMorningUsage(): Promise<void> {
    tokenUsageDb.create({
      provider: 'deepseek',
      model: 'deepseek-chat',
      feature: 'chat',
      inputTokens: 100,
      outputTokens: 50,
    })
    getDatabase().run("UPDATE token_usage SET created_at = '2026-10-16 23:00:00'")
  }

  it('今早七点那次调用，属于"今天"那一格', async () => {
    await seedMorningUsage()

    const today = tokenUsageDb.getByDateRange('2026-10-17', '2026-10-17')
    const yesterday = tokenUsageDb.getByDateRange('2026-10-16', '2026-10-16')

    expect(today, 'SQL 用 date(created_at) 按 UTC 日切，而窗口键是本地日 ⇒ 早上那笔被算进昨天')
      .toHaveLength(1)
    expect(yesterday).toHaveLength(0)
  })

  it('趋势图那一格也按本地日归（列表与图不许各给一个"今天"）', async () => {
    await seedMorningUsage()

    const rows = tokenUsageDb.getDailyStats(7)
    expect(rows.map((r) => r.date)).toEqual(['2026-10-17'])
  })
})

describe('旧口径写歪的 reading_time：整列搬到它真正属于的那一天', () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>

  beforeEach(async () => {
    db = await setupTestDatabase()
    mockSettings.clear()
    mockedReading.mockReset().mockResolvedValue({ readTimes: {} } as never)
  })
  afterEach(() => teardownTestDatabase())

  /** 用生产的 upsert 造旧口径数据，再直接补一个计数器列 —— 计数器不许跟着搬 */
  function seedLegacyRows(): void {
    dailyStatsDb.upsertReadingTime('2026-09-05', 167)
    dailyStatsDb.upsertReadingTime('2026-09-06', 1459)
    db.run('UPDATE daily_stats SET highlights_added = 4 WHERE date = ?', ['2026-09-05'])
  }

  /** 旧键是怎么来的：微信读书那个 epoch 落在 UTC 的哪一天 */
  const legacyRemap = (day: string): string | null => {
    const fixed = localDayKey(new Date(`${day}T16:00:00Z`))
    return fixed === day ? null : fixed
  }

  it('值搬到本地日、原行归零，计数器列一个字不动', () => {
    seedLegacyRows()

    const moved = dailyStatsDb.moveReadingTimeDays(legacyRemap)

    expect(moved, '一个都没搬 ⇒ remap 根本没被用起来').toBe(2)
    expect(readRow('2026-09-06')?.reading_time, '09-05 那 167 秒应该搬到 09-06').toBe(167)
    expect(readRow('2026-09-07')?.reading_time).toBe(1459)
    expect(readRow('2026-09-05')?.reading_time, '旧键上那一份没清掉 ⇒ 区间求和双计').toBe(0)
    expect(readRow('2026-09-05')?.highlights_added, '划线数是当场写的，不该被推移').toBe(4)
  })

  it('remap 说"这行本来就对"时一个字都不动（幂等的根）', () => {
    seedLegacyRows()
    const moved = dailyStatsDb.moveReadingTimeDays(() => null)
    expect(moved).toBe(0)
    expect(readRow('2026-09-05')?.reading_time).toBe(167)
  })

  it('目标行已有值时按来源覆盖（相加就凭空多出一天的阅读时长）', () => {
    dailyStatsDb.upsertReadingTime('2026-09-05', 167)
    dailyStatsDb.upsertReadingTime('2026-09-06', 999)

    dailyStatsDb.moveReadingTimeDays((day) => (day === '2026-09-05' ? '2026-09-06' : null))

    expect(readRow('2026-09-06')?.reading_time).toBe(167)
    expect(readRow('2026-09-05')?.reading_time).toBe(0)
  })

  it('启动修复只搬一次：第二次跑必须不再改动数据', async () => {
    seedLegacyRows()

    const first = await runStartupRepair()
    expect(first.readingTimeShifted, '结果里没有"搬了多少天"这一项 ⇒ 这道门没接进启动').toBeGreaterThan(0)
    const afterFirst = readRow('2026-09-06')?.reading_time

    const second = await runStartupRepair()
    expect(second.readingTimeShifted).toBe(0)
    expect(readRow('2026-09-06')?.reading_time, '第二次又搬 ⇒ 历史被推成差两天').toBe(afterFirst)
  })
})
