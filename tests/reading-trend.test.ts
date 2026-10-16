// 统计页趋势图口径（2026-09-21）
//
// 修之前的三个毛病，逐条钉住：
//   ① chip 标「近 30 天」而柱子只有最后 7 根（标题与数据各说一套）
//   ② 选「本年」时把 12 个**按天**的点直接标成「1月…12月」
//   ③ 时段名字两套：chip 说「近 7 天」、KPI 卡说「本周」
//
// 2026-10-16 补第四个毛病：hero 副标题写死「N 年度阅读数据」，
//   选「本周」时标题说全年、屏上数字是 7 天 —— 同一条「名字只有一套」的规则漏了这一处。

import { describe, it, expect } from 'vitest'
import {
  READING_MODES,
  READING_TREND_SPECS,
  buildReadingTrendPoints,
  statsHeroSubtitle,
} from '../src/shared/reading-trend'
import type { ReadingMode } from '../src/shared/types'

/** 构造连续 n 天的 day→seconds 表（每天 60 秒，日期从 start 起） */
function daily(n: number, start = new Date(2026, 5, 1)): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0)
    out[String(Math.floor(d.getTime() / 1000))] = 60
  }
  return out
}

describe('时段 spec', () => {
  it('每个 ReadingMode 取值都有口径，漏一个就判红', () => {
    const all: ReadingMode[] = ['weekly', 'monthly', 'annually', 'overall']
    expect([...READING_MODES].sort()).toEqual([...all].sort())
    for (const mode of all) expect(READING_TREND_SPECS[mode]).toBeTruthy()
  })

  it('名字只有一套：chip 说的窗口和 KPI 卡前缀是同一个字符串', () => {
    expect(READING_TREND_SPECS.weekly.chipLabel).toBe('本周')
    expect(READING_TREND_SPECS.monthly.chipLabel).toBe('本月')
    expect(READING_TREND_SPECS.annually.chipLabel).toBe('本年')
  })
})

describe('按天分桶（本周 / 本月）', () => {
  it('给 30 天就画 30 根柱子，不再被截成 7 根', () => {
    const points = buildReadingTrendPoints(daily(30), 'monthly')
    expect(points).toHaveLength(30)
  })

  it('本周给 7 天就是 7 根，标签是 月/日', () => {
    const points = buildReadingTrendPoints(daily(7), 'weekly')
    expect(points).toHaveLength(7)
    expect(points[0].label).toBe('6/1')
    expect(points.every((p) => /^\d{1,2}\/\d{1,2}$/.test(p.label))).toBe(true)
  })
})

describe('按月分桶（本年 / 总计）', () => {
  it('柱子数 = 月份数，且每月是各天求和', () => {
    // 6 月 30 天 + 7 月 31 天，每天 60 秒
    const points = buildReadingTrendPoints(daily(61), 'annually')
    expect(points).toHaveLength(2)
    expect(points[0].label).toBe('6月')
    expect(points[0].seconds).toBe(30 * 60)
    expect(points[1].label).toBe('7月')
    expect(points[1].seconds).toBe(31 * 60)
  })

  it('跨年不合并同名月份，且按时间正序', () => {
    const data = { ...daily(31, new Date(2025, 2, 1)), ...daily(31, new Date(2026, 2, 1)) }
    const points = buildReadingTrendPoints(data, 'annually')
    expect(points).toHaveLength(2)
    expect(points[0].ts).toBeLessThan(points[1].ts)
    expect(points.map((p) => new Date(p.ts * 1000).getFullYear())).toEqual([2025, 2026])
  })
})

describe('脏数据', () => {
  it('空 / 缺失 / 非正数一律不画空柱', () => {
    expect(buildReadingTrendPoints(undefined, 'weekly')).toEqual([])
    expect(buildReadingTrendPoints({}, 'weekly')).toEqual([])
    expect(buildReadingTrendPoints({ abc: 60, '0': 60 }, 'weekly')).toEqual([])
    expect(buildReadingTrendPoints({ '1780000000': 0 }, 'annually')).toEqual([])
  })
})

describe('hero 副标题说的窗口 = 用户点的那一档', () => {
  // 2026-10-12 上午（本地）—— 用本地构造，被测函数也用本地取值，不隔一层 UTC
  const baseTime = Math.floor(new Date(2026, 9, 12, 9, 0, 0).getTime() / 1000)
  // 「副标题的窗口名要与顶部 chip 一字相同」这条对账不在这里跑：
  // chip 的标签已由 tests/no-fake-controls.test.ts 钉成「必须取 READING_TREND_SPECS[key].chipLabel」，
  // 而两边同源之后再加一遍就是同义反复；真要 import 那个渲染层文件，还得把它拖进覆盖率台账。

  it('三档各说各的窗口，不再一律写「年度」', () => {
    // 病：chip 选「本周」，副标题照样说「2026 年度阅读数据」——
    // 屏上那几个 KPI 数的是本周，标题却承诺全年，两句里只有一句是真的。
    expect(statsHeroSubtitle('weekly', baseTime)).toBe('本周阅读数据 · 截至 2026 年 10 月 12 日')
    expect(statsHeroSubtitle('monthly', baseTime)).toBe('本月阅读数据 · 截至 2026 年 10 月 12 日')
    expect(statsHeroSubtitle('annually', baseTime)).toBe('本年阅读数据 · 截至 2026 年 10 月 12 日')
  })

  it('取数锚点缺失或是脏值 ⇒ 回到通用文案，不编一个日期出来', () => {
    const generic = '一屏掌握阅读时长、书籍分布与复习节奏'
    expect(statsHeroSubtitle('monthly', undefined)).toBe(generic)
    expect(statsHeroSubtitle('monthly', null)).toBe(generic)
    expect(statsHeroSubtitle('monthly', NaN)).toBe(generic)
    expect(statsHeroSubtitle('monthly', 0)).toBe(generic)
    expect(statsHeroSubtitle('monthly', -1)).toBe(generic)
    // 字符串会被 JS 当数字用（'1780...' * 1000 算得动），闸门按类型收窄
    expect(statsHeroSubtitle('monthly', '1780000000' as unknown as number)).toBe(generic)
  })

  it('档位拿到不认识的取值时按本月说 —— 与趋势图同一兜底，不许两处各种一套', () => {
    expect(statsHeroSubtitle('nope' as ReadingMode, baseTime)).toBe(
      statsHeroSubtitle('monthly', baseTime),
    )
  })
})
