/**
 * 「近 N 天」这个窗口到底含几天（2026-10-17，与 daily_stats 那次同一个根的第二处）
 *
 * 统计页与用量页各写了一份"日期范围 → { startDate, endDate }"，两边都是：
 *   end.setHours(23,59,59) 后取 `toISOString()` 的日  ⇒ UTC+8 上恰好是本地那一天；
 *   start.setHours(0,0,0,0) 后再取 `toISOString()` 的日 ⇒ **本地零点 = 前一天 16:00 UTC**，于是起始日往前多一天。
 * 实测（TZ=Asia/Shanghai，本地 00:30 与 13:00 两个时刻同答案）：
 *   getStatsRangeDates('7d') ⇒ { startDate: '2026-10-10', endDate: '2026-10-17' } —— **闭区间 8 天**。
 * 而 `ReadingStatsView` 是对 `getRange` 交回的每一行求和、还把 `dailyRangeData.length` 当"天数"显示
 * ⇒ 界面说「近 7 天」，算的却是 8 天。
 *
 * 判据钉的是不变量本身（**闭区间恰含 N 天**）+ 跨年跨月的边界 + 两处接线，不是钉某天的具体数字。
 */
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { windowEndingToday, shiftDayKey, localDayKey } from '../src/shared/db-time'

/** 闭区间含几天：两个 `YYYY-MM-DD` 之间（含两端）的日历日数 */
function spanDays(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1
}

describe('windowEndingToday：说 N 天就恰好 N 天', () => {
  const localAfternoon = new Date('2026-10-17T05:00:00Z') // 北京 10-17 13:00
  const localJustPastMidnight = new Date('2026-10-16T16:30:00Z') // 北京 10-17 00:30

  it.each([7, 14, 30, 90, 365])('近 %i 天：闭区间恰含 %i 天', (days) => {
    for (const now of [localAfternoon, localJustPastMidnight]) {
      const { startDate, endDate } = windowEndingToday(days, now)
      expect(spanDays(startDate, endDate), `days=${days} @ ${now.toISOString()}`).toBe(days)
      expect(endDate, '末日必须是本地那一天').toBe(localDayKey(now))
    }
  })

  it('凌晨与下午取到同一个窗口（旧写法靠 toISOString 会往前多一天）', () => {
    expect(windowEndingToday(7, localJustPastMidnight)).toEqual(windowEndingToday(7, localAfternoon))
    expect(windowEndingToday(7, localAfternoon).startDate, '旧实现这里是 10-10（多一天）').toBe('2026-10-11')
  })

  it('跨年、跨月各自数对（月长不同，靠"30 天"近似会歪）', () => {
    const jan3 = new Date('2026-01-02T16:30:00Z') // 北京 2026-01-03 00:30（实测核对过）
    const { startDate, endDate } = windowEndingToday(7, jan3)
    expect(endDate).toBe('2026-01-03')
    expect(startDate).toBe('2025-12-28')
    expect(spanDays(startDate, endDate)).toBe(7)

    // 2 月：2026 不是闰年，2-28 往前 7 天应到 2-22
    const feb28 = new Date('2026-02-27T16:00:00Z')
    expect(windowEndingToday(7, feb28)).toEqual({ startDate: '2026-02-22', endDate: '2026-02-28' })
  })

  it('days 不是正整数时不给"半个窗口"：一律按 1 天收口', () => {
    const now = localAfternoon
    for (const bad of [0, -3, 1.5, Number.NaN, undefined]) {
      const { startDate, endDate } = windowEndingToday(bad as number, now)
      expect(spanDays(startDate, endDate)).toBe(1)
    }
  })
})

describe('shiftDayKey：日历日键的加减（不碰时区，纯日期算术）', () => {
  it('加减跨月跨年都落在真实的那一日', () => {
    expect(shiftDayKey('2026-10-17', -6)).toBe('2026-10-11')
    expect(shiftDayKey('2026-01-03', -6)).toBe('2025-12-28')
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01')
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29') // 闰年
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('0 天是同一个键；脏输入一律 null（不猜、不返回 Invalid Date）', () => {
    expect(shiftDayKey('2026-10-17', 0)).toBe('2026-10-17')
    expect(shiftDayKey('', 1)).toBeNull()
    expect(shiftDayKey('2026-13-45', 1)).toBeNull()
    expect(shiftDayKey('说不上来', 1)).toBeNull()
    expect(shiftDayKey('2026-10-17', Number.NaN)).toBeNull()
  })
})

describe('接线：那两份"自己算窗口"的代码不再各写一份', () => {
  const stats = readFileSync('src/renderer/src/pages/stats/constants.ts', 'utf8')
  const usage = readFileSync('src/renderer/src/pages/token-usage/format.ts', 'utf8')

  it('两份窗口都不再用 toISOString 取日', () => {
    for (const [name, src] of [['stats/constants', stats], ['token-usage/format', usage]] as const) {
      expect(src, `${name} 还在用 toISOString().split('T')[0] 取日子`).not.toMatch(/toISOString\(\)\.split\('T'\)/)
    }
  })

  it('两份都改走 windowEndingToday（一处口径，两处消费）', () => {
    expect(stats).toContain('windowEndingToday')
    expect(usage).toContain('windowEndingToday')
  })

  it('正向控制：这两个函数真的能读到（读空了上面两条就是空话）', () => {
    expect(stats.length, 'stats/constants.ts 没读到内容').toBeGreaterThan(500)
    expect(usage.length, 'token-usage/format.ts 没读到内容').toBeGreaterThan(500)
  })
})
