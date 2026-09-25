// 知行读书 — 档案页数字的算法（src/shared/profile-stats.ts）
//
// 起因：用户看着「个人档案」问「年度阅读时间是 0，是假的吧」。量真实数据库后确认
// daily_stats 里今年一共有 3252 秒阅读（= 54 分钟），而界面写的是 `Math.floor(秒/3600)`
// → 54 分钟被截成 0h，同一张卡下面却写着「日均 6min」，自相矛盾。
// 顺带查出：阅读热力图读的是 `row.readingTime`，而 IPC 传的是 `reading_time`
// → 一格都不会亮；「复习卡片」的副标题拿阅读时长冒充复习时长。
//
// 这个模块只放纯计算，界面不许自己再算一遍 —— 否则又是第二套口径。

import { describe, it, expect } from 'vitest'
import {
  normalizeDailyStatRow,
  formatReadingDuration,
  sumReadingSeconds,
  daysWithActivity,
  averageMinutesPerActiveDay,
  localDateStr,
  computeStreaks,
  lastActiveDate,
  weekTrend,
  heatLevels,
  yearToDateWindow,
  statsWindow,
  inRange,
  type ActivityDay,
} from '../src/shared/profile-stats'
import type { DailyStatsRow } from '../src/shared/types'

/** 数据库真实形状：sql.js rowsToObjects 出来的就是 snake_case */
function dbRow(over: Partial<DailyStatsRow> = {}): DailyStatsRow {
  return {
    id: 'daily_2026-09-10',
    date: '2026-09-10',
    books_read: 0,
    highlights_added: 0,
    cards_reviewed: 0,
    reading_time: 0,
    created_at: '2026-09-10 08:00:00',
    ...over,
  }
}

function row(over: Partial<ActivityDay> = {}): ActivityDay {
  return {
    date: '2026-09-10',
    readingTime: 0,
    highlightsAdded: 0,
    cardsReviewed: 0,
    booksRead: 0,
    ...over,
  }
}

describe('normalizeDailyStatRow — 必须读得到数据库的真实列名', () => {
  it('snake_case（线上真实形状）四个字段都不丢', () => {
    const n = normalizeDailyStatRow(
      dbRow({ date: '2026-09-10', reading_time: 1600, highlights_added: 3, cards_reviewed: 8, books_read: 1 })
    )
    expect(n).toEqual({
      date: '2026-09-10',
      readingTime: 1600,
      highlightsAdded: 3,
      cardsReviewed: 8,
      booksRead: 1,
    })
  })

  it('驼峰拼法不再"两种都认"：读不到的列就是 0，不猜', () => {
    // 曾经这里写着 `raw.reading_time ?? raw.readingTime ?? raw.readingTimeSeconds`，
    // 后两种拼法没有任何生产方（getToday/getRange 都是 SELECT *），
    // 留着只会让人以为线上传过驼峰。真实形状由上一条用例钉住。
    const n = normalizeDailyStatRow(dbRow({ date: '2026-09-11', reading_time: 0 }))
    if (n === null) throw new Error('合法行被 normalizeDailyStatRow 判成了 null')
    expect(n).toEqual({ date: '2026-09-11', readingTime: 0, highlightsAdded: 0, cardsReviewed: 0, booksRead: 0 })
  })

  it('缺列/脏值一律归 0，日期非法就返回 null（不产出 NaN 传染界面）', () => {
    // 这两行的前提是"日期合法 ⇒ 不返回 null"，所以先把 null 断掉再比字段。
    // SQLite 的列类型是建议性的（INTEGER 列里可以躺进 TEXT 或 NULL），
    // 所以脏值这两处绕一下类型 —— 类型管的是"通道给什么形状"，管不了"库里躺着什么"。
    const nullTime = normalizeDailyStatRow(
      dbRow({ date: '2026-09-12', reading_time: null as unknown as number }),
    )
    const dirtyTime = normalizeDailyStatRow(
      dbRow({ reading_time: 'abc' as unknown as number }),
    )
    expect(nullTime).not.toBeNull()
    expect(dirtyTime).not.toBeNull()
    expect(nullTime!.readingTime).toBe(0)
    expect(dirtyTime!.readingTime).toBe(0)
    expect(normalizeDailyStatRow(dbRow({ date: '' }))).toBeNull()
    expect(normalizeDailyStatRow(dbRow({ date: 'not-a-date' }))).toBeNull()
  })
})

describe('formatReadingDuration — 不许把 54 分钟说成 0', () => {
  it('不足 1 小时的真实值保持分钟量级（这条就是那个 0h bug）', () => {
    expect(formatReadingDuration(3252)).toBe('54 分钟')
  })

  it('按量级自适应单位：秒 / 分钟 / 小时+分', () => {
    expect(formatReadingDuration(0)).toBe('0 分钟')
    expect(formatReadingDuration(45)).toBe('45 秒')
    expect(formatReadingDuration(3600)).toBe('1 小时')
    expect(formatReadingDuration(3661)).toBe('1 小时 1 分')
    expect(formatReadingDuration(7325)).toBe('2 小时 2 分')
  })
})

describe('窗口聚合', () => {
  const rows = [
    row({ date: '2026-09-05', readingTime: 167 }),
    row({ date: '2026-09-06', readingTime: 1459 }),
    row({ date: '2026-09-07', readingTime: 8 }),
    row({ date: '2026-09-08' }), // 有行、零活动：过去被当分母，摊薄了日均
    row({ date: '2026-09-09' }),
    row({ date: '2026-09-10', readingTime: 1600 }),
    row({ date: '2026-09-11', readingTime: 18 }),
    row({ date: '2026-09-12', cardsReviewed: 8 }),
  ]

  it('总时长 = 逐日相加', () => {
    expect(sumReadingSeconds(rows)).toBe(3252)
  })

  it('有活动的天数：只算真的有事发生的日子', () => {
    expect(daysWithActivity(rows)).toBe(6)
  })

  it('日均按「有活动的天数」取平均，零活动行不摊薄', () => {
    // 3252 秒 / 6 天 = 542 秒 = 9 分钟（旧算法除以 8 行 → 6 分钟，把 0 也当一天）
    expect(averageMinutesPerActiveDay(rows)).toBe(9)
  })

  it('一天活动都没有时不报 NaN（除以 0）', () => {
    expect(averageMinutesPerActiveDay([row({ date: '2026-09-08' })])).toBe(0)
    expect(averageMinutesPerActiveDay([])).toBe(0)
  })
})

describe('localDateStr — 早上打开应用不许算成昨天', () => {
  it('本地凌晨 0 点仍属于「今天」', () => {
    expect(localDateStr(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
  })

  it('本地深夜 23:59 仍属于「今天」', () => {
    expect(localDateStr(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31')
  })

  it('月/日补零', () => {
    expect(localDateStr(new Date(2026, 8, 5, 12, 0, 0))).toBe('2026-09-05')
  })
})

describe('computeStreaks — 打卡 = 当天任一活动', () => {
  const today = '2026-09-20'

  it('今天还没读，昨天读了 → 连击不断（一天结束时才算断）', () => {
    const rows = [
      row({ date: '2026-09-18', readingTime: 100 }),
      row({ date: '2026-09-19', readingTime: 100 }),
    ]
    expect(computeStreaks(rows, today).current).toBe(2)
  })

  it('中间断一天 → 当前连击归 0', () => {
    const rows = [
      row({ date: '2026-09-17', readingTime: 100 }),
      row({ date: '2026-09-19', readingTime: 100 }),
    ]
    expect(computeStreaks(rows, today).current).toBe(1)
  })

  it('有行但零活动的那天不算打卡', () => {
    // 09-20 有一条 reading_time=0 的记录（同步过但没读），连击只能从 09-19 往回数
    const rows = [row({ date: '2026-09-20' }), row({ date: '2026-09-19', readingTime: 100 })]
    expect(computeStreaks(rows, today).current).toBe(1)
  })

  it('最长连击看历史，与「今天」锚点无关', () => {
    const rows = [
      row({ date: '2026-09-01', readingTime: 10 }),
      row({ date: '2026-09-02', readingTime: 10 }),
      row({ date: '2026-09-03', readingTime: 10 }),
      row({ date: '2026-09-10', readingTime: 10 }),
      row({ date: '2026-09-19', cardsReviewed: 1 }),
    ]
    const { current, longest } = computeStreaks(rows, today)
    expect(current).toBe(1)
    expect(longest).toBe(3)
  })

  it('完全没数据 → 0 / 0，不编出日期', () => {
    expect(computeStreaks([], today)).toEqual({ current: 0, longest: 0 })
  })

  it('lastActiveDate 给出最近一次有活动的日子，零活动行不算', () => {
    const rows = [
      row({ date: '2026-09-12', cardsReviewed: 1 }),
      row({ date: '2026-09-15' }),
      row({ date: '2026-09-10', readingTime: 60 }),
    ]
    expect(lastActiveDate(rows)).toBe('2026-09-12')
    expect(lastActiveDate([row({ date: '2026-09-15' })])).toBeNull()
    expect(lastActiveDate([])).toBeNull()
  })
})

describe('weekTrend — 箭头只在真的涨了时才向上', () => {
  const today = '2026-09-20'

  const rowsWith = (recent: number, prior: number): ActivityDay[] => [
    row({ date: '2026-09-19', readingTime: recent }),
    row({ date: '2026-09-08', readingTime: prior }),
  ]

  it('近 7 天多于前 7 天 → up', () => {
    expect(weekTrend(rowsWith(600, 300), today)).toBe('up')
  })

  it('近 7 天少于前 7 天 → down（旧界面永远画 ↑）', () => {
    expect(weekTrend(rowsWith(300, 600), today)).toBe('down')
  })

  it('相等或两段都为 0 → flat，不假装在进步', () => {
    expect(weekTrend(rowsWith(300, 300), today)).toBe('flat')
    expect(weekTrend([], today)).toBe('flat')
  })
})

describe('heatLevels — 热力图必须读得到 reading_time', () => {
  const today = '2026-09-12'
  const weeks = 2

  it('1600 秒落在「< 30 分钟」那一档，且窗口内其他格保持 0', () => {
    const levels = heatLevels([row({ date: '2026-09-10', readingTime: 1600 })], today, weeks)
    expect(levels).toHaveLength(14)
    // 窗口 = 08-30 .. 09-12，09-10 是倒数第 3 格
    expect(levels[11]).toBe(1)
    expect(levels.filter((l) => l > 0)).toEqual([1])
  })

  it('档位边界：30 分钟 / 1 小时 / 2 小时', () => {
    const at = (seconds: number) =>
      heatLevels([row({ date: today, readingTime: seconds })], today, weeks)[13]
    expect(at(1)).toBe(1)
    expect(at(1799)).toBe(1)
    expect(at(1800)).toBe(2)
    expect(at(3600)).toBe(3)
    expect(at(7200)).toBe(4)
  })

  it('窗口外的日期被丢掉，不会串到别的格子上', () => {
    expect(heatLevels([row({ date: '2020-01-01', readingTime: 9999 })], today, weeks)).toEqual(
      Array(14).fill(0)
    )
  })
})

describe('yearToDateWindow — 「年度」就得真是年度', () => {
  it('起点是今年 1 月 1 日，终点是今天', () => {
    expect(yearToDateWindow(new Date(2026, 8, 20, 10, 0, 0))).toEqual({
      start: '2026-01-01',
      end: '2026-09-20',
    })
  })

  it('元旦当天窗口只有一天', () => {
    expect(yearToDateWindow(new Date(2026, 0, 1, 0, 0, 0))).toEqual({
      start: '2026-01-01',
      end: '2026-01-01',
    })
  })
})

describe('statsWindow — 一次取数同时喂「年度 KPI」和「26 周热力图」', () => {
  it('年中：1 月 1 日比热力起点更早，取年度起点就够两边用', () => {
    expect(statsWindow(new Date(2026, 8, 20))).toEqual({ start: '2026-01-01', end: '2026-09-20' })
  })

  it('年初：热力图仍要铺满 26 周，所以窗口跨年取到去年 7 月', () => {
    expect(statsWindow(new Date(2026, 0, 5)).start).toBe('2025-07-08')
  })

  it('inRange 把窗口外的天滤掉 —— 年度 KPI 不能把去年的阅读算进今年', () => {
    const rows = [
      row({ date: '2025-04-01', readingTime: 5000 }),
      row({ date: '2026-01-01', readingTime: 10 }),
      row({ date: '2026-09-20', readingTime: 20 }),
      row({ date: '2026-09-21', readingTime: 999 }),
    ]
    expect(inRange(rows, '2026-01-01', '2026-09-20').map((r) => r.date)).toEqual([
      '2026-01-01',
      '2026-09-20',
    ])
  })
})
