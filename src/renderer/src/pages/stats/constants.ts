/** 统计页的类型与常量（从 Stats.tsx 原样搬出，逻辑未改） */
import type { ReadingMode } from '../../../../shared/types'
import { READING_TREND_SPECS } from '../../../../shared/reading-trend'
import { windowEndingToday, dbTimeEpoch } from '../../../../shared/db-time'

export type TabKey = 'reading' | 'books'
export type SortColumn = 'title' | 'progress' | 'highlights' | 'cards'
export type SortOrder = 'asc' | 'desc'
export type StatsDateRange = '7d' | '30d' | '90d' | 'all'

export interface BookStat {
  id: string
  title: string
  author: string
  cover: string
  category: string
  progress: number
  highlightCount: number
  cardCount: number
  lastReadAt?: string
  updatedAt?: string
  publishDate?: string
  isFinished?: boolean
}

// ===== 常量 =====

/**
 * 顶部时段 chip（控制 KPI 与趋势图）。
 *
 * 标签、趋势图标题与分桶粒度全部取自 READING_TREND_SPECS —— 之前 chip 写「近 7 天 /
 * 近 30 天 / 近 12 个月」，而微信读书的 mode 是**本周 / 本月 / 本年**（窗口不是滚动天数），
 * 且下面的柱子各按各的切法，同一个数字在三处有三种说法。
 */
export const PERIOD_CHIPS: { key: ReadingMode; label: string; domId: string }[] = (
  ['weekly', 'monthly', 'annually'] as ReadingMode[]
).map((key) => ({
  key,
  label: READING_TREND_SPECS[key].chipLabel,
  domId: `period-${key}`,
}))

/** 周标签（周一到周日） */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 甜甜圈分类配色（与设计稿一致：chart-1 / chart-5 / chart-3 / chart-2 / chart-4 循环） */
export const DONUT_PALETTE = [
  'var(--chart-1)',
  'var(--chart-5)',
  'var(--chart-3)',
  'var(--chart-2)',
  'var(--chart-4)',
]

/** 「年度书单」卡自己的统计范围（只影响这一张卡，与顶部时段 chip 无关） */
export const STATS_DATE_RANGES: { key: StatsDateRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'all', label: '全部' },
]

/** 日期范围 → 天数（'all' 用 3650 天近似 10 年，覆盖全量数据） */
export const STATS_RANGE_DAYS: Record<StatsDateRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 3650,
}

/** 日期范围 → { startDate, endDate } 闭区间的日历日键（含今天，恰 N 天） */
export function getStatsRangeDates(range: StatsDateRange): { startDate: string; endDate: string } {
  return windowEndingToday(STATS_RANGE_DAYS[range], new Date())
}

/**
 * 那一行「最后更新」到底是哪一刻；缺失或解不出来 ⇒ `null`。
 * 年度书单与按年筛选这两处原先各写一遍 `new Date(x).getTime()` + `isNaN`，现在都问 `db-time` 这一把尺。
 */
export function bookUpdatedAtEpoch(stat: BookStat): number | null {
  return dbTimeEpoch(stat.updatedAt)
}

/**
 * 年度书单按「最后更新」倒序。
 *
 * 「读不出时刻」在这里不当 0 混进有效时间里比较（旧写法会，`NaN` 让 `sort` 拿到 0 ⇒ 谁前谁后由实现决定）：
 * 它一律落到最后。两份抄件里真正跑得到的数据都出自 `safeDate`（要么能解、要么空串），所以这个改动
 * 只影响"脏值到底排哪"这条从没被说清的规则，不影响任何一条正常数据的前后顺序。
 */
export function byUpdatedAtDesc(a: BookStat, b: BookStat): number {
  return (bookUpdatedAtEpoch(b) ?? 0) - (bookUpdatedAtEpoch(a) ?? 0)
}
