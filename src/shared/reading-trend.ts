/**
 * 统计页「阅读趋势」的唯一口径。
 *
 * 为什么放这里：时段 chip、KPI 卡标题、趋势图标题、柱子的分桶粒度原先分写四处，
 * 结果 chip 承诺「近 30 天」而图只画最后 7 个点、选「本年」时把 12 个**按天**的点
 * 标成「1月…12月」。收成一份 spec 后，标题与数据不可能各说一套。
 *
 * 微信读书 /readdata/detail 的 readTimes 键是**天级** Unix 秒，mode 只换窗口
 * （本周 / 本月 / 本年），不换粒度 —— 所以"每月"必须我们自己按月聚合。
 */

import type { ReadingMode } from './types'
import { localDayKey } from './db-time'

export interface ReadingTrendSpec {
  /** 时段 chip 与「{chipLabel}阅读」KPI 卡共用 */
  chipLabel: string
  /** 趋势图标题：说清窗口 + 粒度 */
  trendTitle: string
  /** 分桶粒度：day 保留每天一个柱，month 按月求和 */
  bucket: 'day' | 'month'
  badge: string
}

export const READING_MODES: readonly ReadingMode[] = ['weekly', 'monthly', 'annually', 'overall']

export const READING_TREND_SPECS: Record<ReadingMode, ReadingTrendSpec> = {
  weekly: { chipLabel: '本周', trendTitle: '本周每日时长', bucket: 'day', badge: '每日' },
  monthly: { chipLabel: '本月', trendTitle: '本月每日时长', bucket: 'day', badge: '每日' },
  annually: { chipLabel: '本年', trendTitle: '本年每月时长', bucket: 'month', badge: '每月' },
  overall: { chipLabel: '总计', trendTitle: '每月时长', bucket: 'month', badge: '每月' },
}

/** 还没拿到取数锚点时说的话 —— 与统计页原来那句一字未改 */
export const STATS_HERO_FALLBACK = '一屏掌握阅读时长、书籍分布与复习节奏'

/**
 * 统计页顶部那句副标题：这一屏数的是哪个窗口、截至哪天。
 *
 * 病（2026-10-16 量出来）：它原先写死 `${年份} 年度阅读数据`，而下面那排 chip 是
 * 本周 / 本月 / 本年三档、KPI 与趋势图都跟着档位重取数 —— 于是选「本周」时
 * 标题承诺的是全年，屏上的数字是 7 天，两句里只有一句是真的。
 *
 * 窗口名一律取 READING_TREND_SPECS.chipLabel（与 chip、KPI 卡前缀、趋势图标题同一份），
 * 年份放进「截至」的日期里，由锚点自己带出来，不再由标题替用户决定看的是哪一段。
 */
export function statsHeroSubtitle(
  mode: ReadingMode,
  baseTime: number | null | undefined,
): string {
  // 脏锚点（缺字段、NaN、字符串）宁可退回通用文案，也不编一个日期给用户看
  if (typeof baseTime !== 'number' || !Number.isFinite(baseTime) || baseTime <= 0) {
    return STATS_HERO_FALLBACK
  }
  const spec = READING_TREND_SPECS[mode] ?? READING_TREND_SPECS.monthly
  const d = new Date(baseTime * 1000)
  return `${spec.chipLabel}阅读数据 · 截至 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export interface ReadingTrendPoint {
  /** 天级秒（month 桶取该月首日），用作 React key 与排序 */
  ts: number
  seconds: number
  /** 轴标签，由 spec 的粒度决定，渲染处不再自己算 */
  label: string
}

function toDayEntries(readTimes: Record<string, number> | undefined | null): Array<{ ts: number; seconds: number }> {
  if (!readTimes) return []
  return Object.entries(readTimes)
    .map(([key, value]) => ({ ts: Number(key), seconds: Number(value) }))
    .filter((p) => Number.isFinite(p.ts) && p.ts > 0 && Number.isFinite(p.seconds) && p.seconds > 0)
    .sort((a, b) => a.ts - b.ts)
}

/** 复习热力一格一天，铺 12 周 */
export const REVIEW_HEATMAP_DAYS = 84

/**
 * 最近 N 天的**本地**日期串（旧 → 新）。
 *
 * 取数窗口、热力格子、徽标求和都从这里拿，三处不会各算各的；
 * 键的形状只有一个所有者 —— `db-time.localDayKey`（这一把尺之外不许再手抄一份补零算术），
 * 用 toISOString 会在 UTC+8 的凌晨把「今天」算成昨天，格子整列错位。
 */
export function recentDayKeys(today: Date, days: number = REVIEW_HEATMAP_DAYS): string[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    keys.push(localDayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)))
  }
  return keys
}

/**
 * 把微信读书返回的「按天」阅读时长，按所选时段聚合成要画的柱子。
 *
 * month 桶按本地月份分组（跨年也不会把两个 3 月合并成一个）。
 */
export function buildReadingTrendPoints(
  readTimes: Record<string, number> | undefined | null,
  mode: ReadingMode,
): ReadingTrendPoint[] {
  const spec = READING_TREND_SPECS[mode] ?? READING_TREND_SPECS.monthly
  const entries = toDayEntries(readTimes)
  if (entries.length === 0) return []

  if (spec.bucket === 'day') {
    return entries.map((p) => {
      const d = new Date(p.ts * 1000)
      return { ts: p.ts, seconds: p.seconds, label: `${d.getMonth() + 1}/${d.getDate()}` }
    })
  }

  const byMonth = new Map<string, { ts: number; seconds: number; month: number }>()
  for (const p of entries) {
    const d = new Date(p.ts * 1000)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const existing = byMonth.get(key)
    if (existing) existing.seconds += p.seconds
    else byMonth.set(key, { ts: new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000, seconds: p.seconds, month: d.getMonth() + 1 })
  }
  return [...byMonth.values()]
    .sort((a, b) => a.ts - b.ts)
    .map((m) => ({ ts: m.ts, seconds: m.seconds, label: `${m.month}月` }))
}
