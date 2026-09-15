// 知行读书 — 卡片掌握度 / 保持率（src/shared/fsrs-metrics.ts）单元测试
//
// 掌握度是"由 FSRS 状态推导的展示指标"，所以这里既要验证公式本身的性质
// （单调性 / 边界 / 健壮性），也要验证它与真实 FSRS 调度序列的联动
// （复习次数越多、稳定性越高，掌握度必须越大）。

import { describe, it, expect } from 'vitest'
import {
  getCardMastery,
  getMasteryLevel,
  getRetrievability,
  getRetentionHint,
  MASTERY_THRESHOLDS,
  STABILITY_HALF,
  PRACTICE_HALF,
  FSRS6_DECAY,
} from '../src/shared/fsrs-metrics'
import {
  reviewVocabulary,
  getCardRetentionRate,
  createCard,
  Rating,
  resetParameters,
  type Card,
} from '../electron/fsrs-engine'

describe('getMasteryLevel — 等级阈值', () => {
  it('按 80 / 60 / 30 分档（与 Methodologies 页口径一致）', () => {
    expect(getMasteryLevel(0)).toBe('入门')
    expect(getMasteryLevel(29)).toBe('入门')
    expect(getMasteryLevel(30)).toBe('进阶')
    expect(getMasteryLevel(59)).toBe('进阶')
    expect(getMasteryLevel(60)).toBe('熟练')
    expect(getMasteryLevel(79)).toBe('熟练')
    expect(getMasteryLevel(80)).toBe('精通')
    expect(getMasteryLevel(100)).toBe('精通')
  })

  it('越界值被夹到 [0, 100]', () => {
    expect(getMasteryLevel(-50)).toBe('入门')
    expect(getMasteryLevel(999)).toBe('精通')
    expect(getMasteryLevel(Number.NaN)).toBe('入门')
  })

  it('阈值常量与实现一致', () => {
    expect(getMasteryLevel(MASTERY_THRESHOLDS.intermediate)).toBe('进阶')
    expect(getMasteryLevel(MASTERY_THRESHOLDS.skilled)).toBe('熟练')
    expect(getMasteryLevel(MASTERY_THRESHOLDS.expert)).toBe('精通')
  })
})

describe('getCardMastery — 基础行为', () => {
  it('新卡（无任何 FSRS 状态）掌握度为 0 / 入门', () => {
    const m = getCardMastery({ stability: 0, difficulty: 0, reps: 0, lapses: 0 })
    expect(m.score).toBe(0)
    expect(m.level).toBe('入门')
    expect(m.strength).toBe(0)
    expect(m.practice).toBe(0)
  })

  it('有稳定性但从未复习过，仍判定为 0（防止脏数据给出虚高掌握度）', () => {
    const m = getCardMastery({ stability: 500, difficulty: 3, reps: 0, lapses: 0 })
    expect(m.score).toBe(0)
  })

  it('分数恒在 0-100 之间', () => {
    const cases = [
      { stability: 1e6, difficulty: 1, reps: 1000, lapses: 0 },
      { stability: 0.01, difficulty: 10, reps: 1, lapses: 999 },
      { stability: 30, difficulty: 5, reps: 4, lapses: 3 },
    ]
    for (const c of cases) {
      const m = getCardMastery(c)
      expect(m.score).toBeGreaterThanOrEqual(0)
      expect(m.score).toBeLessThanOrEqual(100)
    }
  })

  it('非法输入不抛错且退化为 0', () => {
    const bad = [
      { stability: Number.NaN, difficulty: 5, reps: 3, lapses: 0 },
      { stability: -100, difficulty: 5, reps: 3, lapses: 0 },
      { stability: 10, difficulty: Number.NaN, reps: 3, lapses: 0 },
      { stability: 10, difficulty: 5, reps: Number.NaN, lapses: 0 },
      { stability: 10, difficulty: 5, reps: 3, lapses: Number.NaN },
    ]
    for (const c of bad) {
      const m = getCardMastery(c)
      expect(Number.isFinite(m.score)).toBe(true)
      expect(m.score).toBeGreaterThanOrEqual(0)
    }
    expect(getCardMastery({ stability: Number.NaN, difficulty: 5, reps: 3, lapses: 0 }).score).toBe(0)
  })

  it('difficulty = 0（未知）按中位难度 5 处理，不当作最简单', () => {
    const unknown = getCardMastery({ stability: 40, difficulty: 0, reps: 5, lapses: 0 })
    const middle = getCardMastery({ stability: 40, difficulty: 5, reps: 5, lapses: 0 })
    const easiest = getCardMastery({ stability: 40, difficulty: 1, reps: 5, lapses: 0 })
    expect(unknown.score).toBe(middle.score)
    expect(unknown.score).toBeLessThan(easiest.score)
  })
})

describe('getCardMastery — 单调性', () => {
  const base = { stability: 30, difficulty: 5, reps: 5, lapses: 0 }

  it('稳定性越大，掌握度越高', () => {
    let prev = -1
    for (const stability of [1, 5, 10, 30, 90, 365, 3000]) {
      const m = getCardMastery({ ...base, stability })
      expect(m.score).toBeGreaterThan(prev)
      prev = m.score
    }
  })

  it('复习次数越多，掌握度越高', () => {
    let prev = -1
    for (const reps of [1, 2, 3, 4, 6, 10, 30]) {
      const m = getCardMastery({ ...base, reps })
      expect(m.score).toBeGreaterThan(prev)
      prev = m.score
    }
  })

  it('难度越高，掌握度越低', () => {
    let prev = 101
    for (const difficulty of [1, 3, 5, 7, 10]) {
      const m = getCardMastery({ ...base, difficulty })
      expect(m.score).toBeLessThan(prev)
      prev = m.score
    }
  })

  it('遗忘次数越多，掌握度越低', () => {
    let prev = 101
    for (const lapses of [0, 1, 3, 10, 50]) {
      const m = getCardMastery({ ...base, lapses })
      expect(m.score).toBeLessThan(prev)
      prev = m.score
    }
  })
})

describe('getCardMastery — 分量语义', () => {
  it('strength 在 S = STABILITY_HALF 时为 0.5', () => {
    const m = getCardMastery({ stability: STABILITY_HALF, difficulty: 5, reps: 10, lapses: 0 })
    expect(m.strength).toBeCloseTo(0.5, 5)
  })

  it('practice 在 reps = PRACTICE_HALF 时为 0.5', () => {
    const m = getCardMastery({ stability: 100, difficulty: 5, reps: PRACTICE_HALF, lapses: 0 })
    expect(m.practice).toBeCloseTo(0.5, 5)
  })

  it('单次高分不足以判定"精通"（必须靠次数累积）', () => {
    // 即便稳定性已经很大，只复习过 1 次也只能是入门
    const oneRep = getCardMastery({ stability: 1000, difficulty: 1, reps: 1, lapses: 0 })
    expect(oneRep.level).toBe('入门')
  })
})

describe('getCardMastery 与真实 FSRS 调度序列联动', () => {
  it('生词连续 Good 复习时，掌握度单调上升并最终进入熟练/精通区间', () => {
    resetParameters()
    let state = {
      efFactor: 2.5,
      intervalDays: 0,
      repetitionCount: 0,
      learningStage: 0,
      familiarityLevel: 0,
      stability: 0,
      difficulty: 0,
      lapses: 0,
    }
    let now = new Date('2026-09-15T00:00:00.000Z')
    const scores: number[] = []
    for (let i = 0; i < 8; i++) {
      const r = reviewVocabulary(state, Rating.Good, now)
      state = {
        efFactor: r.efFactor,
        intervalDays: r.intervalDays,
        repetitionCount: r.repetitionCount,
        learningStage: r.learningStage,
        familiarityLevel: r.familiarityLevel,
        stability: r.stability,
        difficulty: r.difficulty,
        lapses: r.lapses,
      }
      scores.push(
        getCardMastery({
          stability: r.stability,
          difficulty: r.difficulty,
          reps: r.repetitionCount,
          lapses: r.lapses,
        }).score,
      )
      now = new Date(r.nextReviewAt)
    }
    // 第一次评分后因为 stability 小、次数少，分数很低
    expect(scores[0]).toBeLessThan(10)
    // 整体单调不减（FSRS 在连续 Good 下 stability 单调上升）
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    }
    // 反复复习后进入熟练/精通
    expect(scores[scores.length - 1]).toBeGreaterThanOrEqual(MASTERY_THRESHOLDS.skilled)
  })

  it('一次遗忘会立刻拉低掌握度', () => {
    const before = getCardMastery({ stability: 159, difficulty: 2.1, reps: 5, lapses: 0 })
    // 遗忘后：稳定性回落 + lapses +1
    const after = getCardMastery({ stability: 12.3, difficulty: 2.1, reps: 3, lapses: 1 })
    expect(after.score).toBeLessThan(before.score)
  })
})

describe('getRetrievability — 与 ts-fsrs 官方实现逐点一致', () => {
  /**
   * 构造一张"上次复习在 t 天前"的卡片，交给 fsrs-engine 算保持率。
   * ⚠️ 必须显式置为 Review 状态：ts-fsrs 的 get_retrievability 对 State.New 的卡片
   * 一律返回 0（尚未学过就没有可提取性可言），不设置会得到恒 0 的假对比。
   */
  function fsrsRetention(stability: number, elapsedDays: number, now: Date): number {
    const base = createCard('h_retention') as Card
    const lastReview = new Date(now.getTime() - elapsedDays * 24 * 60 * 60 * 1000)
    return getCardRetentionRate(
      {
        ...base,
        state: 2, // CardState.Review
        stability,
        lastReview: lastReview.toISOString(),
        due: now.toISOString(),
      },
      now,
    )
  }

  it('在 (稳定性 × 已过天数) 网格上与 ts-fsrs 结果一致', () => {
    const now = new Date('2026-09-15T00:00:00.000Z')
    const stabilities = [0.5, 1, 2.3, 5, 10, 30, 90, 365, 3000]
    const elapsed = [0, 1, 3, 7, 14, 30, 100, 365]
    // 容差 1e-6：两侧是同一个公式，仅浮点结合顺序不同（实测最大偏差 4.9e-9）。
    // 这个量级足以证明"同一条遗忘曲线"，而不是"两条相近的曲线"。
    const TOLERANCE = 1e-6
    let worst = 0
    let checked = 0
    for (const s of stabilities) {
      for (const t of elapsed) {
        const diff = Math.abs(getRetrievability(s, t) - fsrsRetention(s, t, now))
        worst = Math.max(worst, diff)
        expect(diff).toBeLessThan(TOLERANCE)
        checked++
      }
    }
    expect(checked).toBe(stabilities.length * elapsed.length)
    expect(worst).toBeLessThan(TOLERANCE)
  })

  it('R(t = S) = 0.9（FSRS 的稳定性定义）', () => {
    for (const s of [1, 10, 100, 1000]) {
      expect(getRetrievability(s, s)).toBeCloseTo(0.9, 9)
    }
  })

  it('t = 0 时保持率为 1，且随时间单调下降', () => {
    expect(getRetrievability(30, 0)).toBeCloseTo(1, 9)
    let prev = 1.1
    for (const t of [0, 1, 5, 10, 30, 90, 365, 3650]) {
      const r = getRetrievability(30, t)
      expect(r).toBeLessThan(prev)
      expect(r).toBeGreaterThan(0)
      prev = r
    }
  })

  it('稳定性越大，同一时刻的保持率越高', () => {
    let prev = -1
    for (const s of [1, 5, 30, 365, 3000]) {
      const r = getRetrievability(s, 30)
      expect(r).toBeGreaterThan(prev)
      prev = r
    }
  })

  it('未形成记忆（stability <= 0）与非法输入返回 0', () => {
    expect(getRetrievability(0, 10)).toBe(0)
    expect(getRetrievability(-5, 10)).toBe(0)
    expect(getRetrievability(Number.NaN, 10)).toBe(0)
    expect(getRetrievability(30, Number.NaN)).toBe(0)
    expect(getRetrievability(30, -10)).toBeCloseTo(1, 9)
  })

  it('decay 常量与 FSRS-6.0 一致', () => {
    expect(FSRS6_DECAY).toBeCloseTo(-0.1542, 10)
  })

  it('保持率文案分档', () => {
    expect(getRetentionHint(0)).toBe('尚未形成记忆')
    expect(getRetentionHint(0.95)).toBe('记忆牢固')
    expect(getRetentionHint(0.85)).toBe('记忆良好')
    expect(getRetentionHint(0.75)).toBe('开始模糊')
    expect(getRetentionHint(0.5)).toBe('接近遗忘')
  })
})
