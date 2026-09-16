// 知行读书 — 每日学习量控制（src/shared/study-limits.ts）单元测试
//
// 背景：微信读书同步会把全部划线一次性导入，而 createCard() 让每张新卡的 due
// 就是"现在"。没有每日上限时，用户打开复习页看到的是几百张"待复习"——
// 一个永远做不完的清单，结果就是不再打开。这里验证节流规则本身。

import { describe, it, expect } from 'vitest'
import {
  computeNewCardAllowance,
  normalizeNewCardsPerDay,
  describeDailyQueue,
  DEFAULT_NEW_CARDS_PER_DAY,
  MIN_NEW_CARDS_PER_DAY,
  MAX_NEW_CARDS_PER_DAY,
} from '../src/shared/study-limits'

describe('normalizeNewCardsPerDay — 输入规整', () => {
  it('缺省/非法输入回落到默认值', () => {
    expect(normalizeNewCardsPerDay(undefined)).toBe(DEFAULT_NEW_CARDS_PER_DAY)
    expect(normalizeNewCardsPerDay(null)).toBe(DEFAULT_NEW_CARDS_PER_DAY)
    expect(normalizeNewCardsPerDay(Number.NaN)).toBe(DEFAULT_NEW_CARDS_PER_DAY)
    expect(normalizeNewCardsPerDay('abc')).toBe(DEFAULT_NEW_CARDS_PER_DAY)
  })

  it('字符串数字被接受（settings 存的是 JSON，可能是字符串）', () => {
    expect(normalizeNewCardsPerDay('20')).toBe(20)
    expect(normalizeNewCardsPerDay('7.6')).toBe(8)
  })

  it('夹到 [0, 200] 区间', () => {
    expect(normalizeNewCardsPerDay(-5)).toBe(MIN_NEW_CARDS_PER_DAY)
    expect(normalizeNewCardsPerDay(99999)).toBe(MAX_NEW_CARDS_PER_DAY)
    expect(normalizeNewCardsPerDay(15)).toBe(15)
  })

  it('0 是合法值，表示暂停新卡（只复习旧卡）', () => {
    expect(normalizeNewCardsPerDay(0)).toBe(0)
  })
})

describe('computeNewCardAllowance — 每日额度', () => {
  it('今天一张没学：放出满额（受新卡池上限约束）', () => {
    const q = computeNewCardAllowance({ perDay: 15, introducedToday: 0, available: 934 })
    expect(q.allowance).toBe(15)
    expect(q.available).toBe(934)
    expect(q.perDay).toBe(15)
  })

  it('今天已经学了一部分：额度相应减少', () => {
    expect(computeNewCardAllowance({ perDay: 15, introducedToday: 5, available: 934 }).allowance).toBe(10)
    expect(computeNewCardAllowance({ perDay: 15, introducedToday: 15, available: 934 }).allowance).toBe(0)
  })

  it('超额学习后额度归零，不会变负数', () => {
    const q = computeNewCardAllowance({ perDay: 15, introducedToday: 40, available: 934 })
    expect(q.allowance).toBe(0)
  })

  it('新卡池比额度小的时候，按池子来（不凭空冒出卡片）', () => {
    const q = computeNewCardAllowance({ perDay: 15, introducedToday: 0, available: 3 })
    expect(q.allowance).toBe(3)
  })

  it('新卡池为空时额度恒为 0', () => {
    expect(computeNewCardAllowance({ perDay: 15, introducedToday: 0, available: 0 }).allowance).toBe(0)
  })

  it('perDay = 0（暂停新卡）时额度恒为 0，哪怕池子很大', () => {
    const q = computeNewCardAllowance({ perDay: 0, introducedToday: 0, available: 934 })
    expect(q.allowance).toBe(0)
  })

  it('额度永远不会超过 perDay', () => {
    for (const perDay of [0, 1, 5, 15, 50, 200]) {
      for (const introducedToday of [0, 3, 15, 100]) {
        const q = computeNewCardAllowance({ perDay, introducedToday, available: 10000 })
        expect(q.allowance).toBeLessThanOrEqual(normalizeNewCardsPerDay(perDay))
        expect(q.allowance).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('非法输入不抛错', () => {
    const q = computeNewCardAllowance({
      perDay: Number.NaN,
      introducedToday: Number.NaN,
      available: Number.NaN,
    })
    expect(Number.isFinite(q.allowance)).toBe(true)
    expect(q.allowance).toBe(0)
    expect(q.perDay).toBe(DEFAULT_NEW_CARDS_PER_DAY)
  })
})

describe('describeDailyQueue — 人话展示', () => {
  it('两种都有时分别列出', () => {
    expect(describeDailyQueue(3, 15)).toBe('今天：复习 3 张 · 新卡 15 张')
  })

  it('只有一种时不显示另一项', () => {
    expect(describeDailyQueue(3, 0)).toBe('今天：复习 3 张')
    expect(describeDailyQueue(0, 15)).toBe('今天：新卡 15 张')
  })

  it('都没有时说"没有要复习的内容"，而不是"0 张"', () => {
    expect(describeDailyQueue(0, 0)).toBe('今天没有要复习的内容')
  })

  it('负数/非法输入按 0 处理', () => {
    expect(describeDailyQueue(-3, Number.NaN)).toBe('今天没有要复习的内容')
  })
})
