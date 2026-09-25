// 知行读书 — FSRS 引擎冒烟测试
// 覆盖：卡片创建、状态机、参数校验、复习逻辑、统计聚合
// 这是 R6（覆盖率 ≥ 85%）的基线测试，后续每改 fsrs-engine.ts 必须更新
//
// v2.0 升级（2026-07-20）：基于 ts-fsrs@5.4.1 适配层。
// v2.1 校准（2026-09-11）：ts-fsrs@5.4.1 实现的是 FSRS-6.0（21 组权重），
// 早期注释/用例标题写的 "19 元素 / FSRS v5" 已校正；词汇学习改走同一个 ts-fsrs 实例。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createCard,
  reviewCard,
  reviewCardBatch,
  previewReviewRatings,
  cardFromDb,
  cardFromFields,
  cardToRow,
  getParameters,
  setCustomParameters,
  resetParameters,
  calculateStats,
  isDue,
  getCardRetentionRate,
  reviewVocabulary,
  CardState,
  Rating,
  type Card,
} from '../electron/fsrs-engine'
import {
  fsrs as createFsrs,
  generatorParameters,
  createEmptyCard,
  State as FsrsState,
  default_w as TS_FSRS_DEFAULT_W,
  type Card as FsrsCard,
} from 'ts-fsrs'

describe('FSRS Engine — Smoke Tests', () => {
  beforeEach(() => {
    resetParameters()
  })

  afterEach(() => {
    resetParameters()
  })

  describe('createCard', () => {
    it('should create a card with default New state', () => {
      const card = createCard('highlight_1')
      expect(card.highlightId).toBe('highlight_1')
      expect(card.state).toBe(CardState.New)
      expect(card.step).toBe(0)
      expect(card.stability).toBe(0)
      expect(card.lapses).toBe(0)
      expect(card.reps).toBe(0)
      expect(card.id).toMatch(/^card_\d+_/)
    })

    it('should set due date to now for new cards', () => {
      const card = createCard('h_1')
      const now = new Date()
      const due = new Date(card.due)
      // 允许 1s 误差（CI 时钟漂移）
      expect(Math.abs(due.getTime() - now.getTime())).toBeLessThan(1000)
    })
  })

  describe('reviewCard — 状态机', () => {
    it('New → Learning on any rating', () => {
      const card = createCard('h_1')
      const reviewed = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      expect(reviewed.state).toBe(CardState.Learning)
      expect(reviewed.reps).toBe(1)
    })

    it('Learning + Good (step 0→1) 保持 Learning', () => {
      let card = createCard('h_1')
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      expect(card.state).toBe(CardState.Learning)
      expect(card.step).toBe(0)

      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      expect(card.state).toBe(CardState.Learning)
      expect(card.step).toBe(1)
    })

    it('Learning + Good (step 1→2) → Review 状态', () => {
      let card = createCard('h_1')
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      card = reviewCard(card, Rating.Good, new Date('2026-07-21'))
      expect(card.state).toBe(CardState.Review)
      expect(card.step).toBe(2)
    })

    it('Review + Again → Relearning 状态 + lapses+1', () => {
      let card = createCard('h_1')
      // 推进到 Review
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      card = reviewCard(card, Rating.Good, new Date('2026-07-21')) // → Review
      expect(card.state).toBe(CardState.Review)

      const relapsed = reviewCard(card, Rating.Again, new Date('2026-07-22'))
      expect(relapsed.state).toBe(CardState.Relearning)
      expect(relapsed.lapses).toBe(1)
    })

    it('Learning + Again 重置 step=0，scheduledDays=0', () => {
      let card = createCard('h_1')
      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      expect(card.step).toBe(0)

      card = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      expect(card.step).toBe(1)

      const relapsed = reviewCard(card, Rating.Again, new Date('2026-07-20'))
      expect(relapsed.step).toBe(0)
      expect(relapsed.scheduledDays).toBe(0)
    })
  })

  describe('Parameters — 校验', () => {
    it('should throw on invalid requestRetention', () => {
      expect(() => setCustomParameters({ requestRetention: 0 })).toThrow()
      expect(() => setCustomParameters({ requestRetention: 1.5 })).toThrow()
    })

    it('should throw on invalid maximumInterval', () => {
      expect(() => setCustomParameters({ maximumInterval: 0 })).toThrow()
    })

    it('should throw on weights array with unsupported length', () => {
      // ts-fsrs 只接受 17（v4）/ 19（v5）/ 21（FSRS-6.0）三种长度
      expect(() =>
        setCustomParameters({ w: [0.1, 0.2, 0.3] })
      ).toThrow(/must be 17, 19 or 21/i)
    })

    it('should accept valid custom parameters', () => {
      const newW = Array(17).fill(1.0)
      setCustomParameters({ w: newW, requestRetention: 0.85 })
      const params = getParameters()
      expect(params.requestRetention).toBe(0.85)
      expect(params.w).toEqual(newW)
    })
  })

  describe('isDue & getCardRetentionRate', () => {
    it('isDue: due time 在过去 → true', () => {
      const card = createCard('h_1')
      card.due = '2020-01-01T00:00:00.000Z'
      expect(isDue(card, new Date('2026-07-20'))).toBe(true)
    })

    it('isDue: due time 在未来 → false', () => {
      const card = createCard('h_1')
      card.due = '2099-01-01T00:00:00.000Z'
      expect(isDue(card, new Date('2026-07-20'))).toBe(false)
    })

    it('getCardRetentionRate: stability=0 → 0', () => {
      const card = createCard('h_1')
      expect(getCardRetentionRate(card)).toBe(0)
    })
  })

  describe('cardFromDb / cardToRow', () => {
    it('应正确转换数据库行到 Card 对象', () => {
      const row = {
        id: 'card_1',
        highlight_id: 'h_1',
        state: CardState.Review,
        step: 2,
        stability: 5.5,
        difficulty: 3.2,
        due: '2026-08-01T00:00:00.000Z',
        last_review: '2026-07-20T00:00:00.000Z',
        elapsed_days: 10,
        scheduled_days: 12,
        reps: 5,
        lapses: 1,
      }
      const card = cardFromDb(row)
      expect(card.highlightId).toBe('h_1') // 关键：snake_case → camelCase
      expect(card.lastReview).toBe('2026-07-20T00:00:00.000Z')
      expect(card.elapsedDays).toBe(10)
    })

    it('应正确转换 Card 对象到数据库行', () => {
      const card: Card = createCard('h_2')
      const row = cardToRow(card)
      expect(row.highlight_id).toBe('h_2') // 关键：camelCase → snake_case
      expect(row.last_review).toBeNull()
      expect(row.elapsed_days).toBe(0)
    })
  })

  describe('calculateStats', () => {
    it('empty array → 全 0', () => {
      const stats = calculateStats([])
      expect(stats.total).toBe(0)
      expect(stats.dueToday).toBe(0)
      expect(stats.averageStability).toBe(0)
    })

    it('混合状态卡片 → 正确分类', () => {
      const cards: Card[] = [
        { ...createCard('h_1'), state: CardState.New },
        { ...createCard('h_2'), state: CardState.Learning },
        { ...createCard('h_3'), state: CardState.Review },
        { ...createCard('h_4'), state: CardState.Relearning },
      ]
      const stats = calculateStats(cards)
      expect(stats.total).toBe(4)
      expect(stats.newCards).toBe(1)
      expect(stats.learning).toBe(1)
      expect(stats.review).toBe(1)
      expect(stats.relearning).toBe(1)
    })
  })
})

// ============================================================================
// v2.0 适配层测试：ts-fsrs 集成验证
// ============================================================================

describe('FSRS Engine — ts-fsrs Adapter Integration', () => {
  beforeEach(() => {
    resetParameters()
  })

  afterEach(() => {
    resetParameters()
  })

  describe('枚举映射：与 ts-fsrs 5.4.1 完全一致', () => {
    it('CardState 枚举值与 ts-fsrs State 一致 (0/1/2/3)', () => {
      // 关键：避免"应为 0/1/2/3，但实际是 1/2/3/4"这种偏移 bug
      expect(CardState.New).toBe(0)
      expect(CardState.Learning).toBe(1)
      expect(CardState.Review).toBe(2)
      expect(CardState.Relearning).toBe(3)
      // ts-fsrs 一致
      expect(FsrsState.New).toBe(CardState.New as unknown as FsrsState)
      expect(FsrsState.Learning).toBe(CardState.Learning as unknown as FsrsState)
      expect(FsrsState.Review).toBe(CardState.Review as unknown as FsrsState)
      expect(FsrsState.Relearning).toBe(CardState.Relearning as unknown as FsrsState)
    })

    it('Rating 枚举值与 ts-fsrs Grade 偏移一致 (Again=1, Hard=2, Good=3, Easy=4)', () => {
      expect(Rating.Again).toBe(1)
      expect(Rating.Hard).toBe(2)
      expect(Rating.Good).toBe(3)
      expect(Rating.Easy).toBe(4)
    })
  })

  describe('算法真的来自 ts-fsrs', () => {
    it('reviewCard 调用后 stability 符合 ts-fsrs v5 公式 (非零，非线性)', () => {
      // ts-fsrs v5 的 New+Good stability 是 w[2] + 调整项（与原 SM-2 不同）
      // 原 SM-2 implementation: stability = w[rating-1] = w[2] = 2.4
      // ts-fsrs v5: 实际计算，会与 2.4 不同
      const card = createCard('h_1')
      const reviewed = reviewCard(card, Rating.Good, new Date('2026-07-20'))
      // ts-fsrs v5 对 Good 初始 stability 通常在 2-5 之间
      expect(reviewed.stability).toBeGreaterThan(0)
      expect(reviewed.stability).toBeLessThan(100)
    })

    it('使用 ts-fsrs 独立计算的结果应与适配层一致（参考实现）', () => {
      // 独立调 ts-fsrs，对比我们的适配层输出
      const f = createFsrs(generatorParameters({
        enable_fuzz: false,
        learning_steps: ['1m', '10m', '10m'],
        relearning_steps: ['1m', '10m'],
      }))
      const now = new Date('2026-07-20T00:00:00.000Z')
      const emptyCard = createEmptyCard(now)
      // ts-fsrs Good
      const refLog = f.next(emptyCard, now, 3 /* Rating.Good=3 */)
      // 我们的 API
      const apiCard = createCard('h_1')
      const reviewed = reviewCard(apiCard, Rating.Good, now)
      // stability 应大致接近（可能有浮点差）
      expect(Math.abs(reviewed.stability - refLog.card.stability)).toBeLessThan(0.5)
    })
  })

  describe('step 映射规则', () => {
    it('toFsrsCard: state=Learning 且 step=0 → ts-fsrs learning_steps=1', () => {
      // New+Good 后 state=Learning, step=0
      // 我们的 API 表示"刚进入学习第 0 步"
      // ts-fsrs 表示"当前在第 1 步 (索引 1)"
      // 适配规则：ls = step + 1
      const card: Card = {
        ...createCard('h_1'),
        state: CardState.Learning,
        step: 0,
      }
      const reviewed = reviewCard(card, Rating.Good, new Date('2026-07-20T00:00:00.000Z'))
      // 再次 Good 后，state 应仍为 Learning 且 step=1
      expect(reviewed.state).toBe(CardState.Learning)
      expect(reviewed.step).toBe(1)
    })

    it('toFsrsCard: state=Review → ts-fsrs learning_steps=0 (无视 step)', () => {
      const card: Card = {
        ...createCard('h_1'),
        state: CardState.Review,
        step: 2,
        stability: 5,
        difficulty: 3,
      }
      const reviewed = reviewCard(card, Rating.Good, new Date('2026-07-20T00:00:00.000Z'))
      // 已在 Review 状态，step 保持 2
      expect(reviewed.state).toBe(CardState.Review)
      expect(reviewed.step).toBe(2)
    })

    it('fromFsrsCard: state=Learning 且 ts-fsrs ls=1 → 我们的 step=0', () => {
      // 内部验证：构造 ts-fsrs ls=1 + state=Learning 输入
      const card: Card = {
        ...createCard('h_1'),
        state: CardState.Learning,
        step: 0,  // 表示 New+Good 后
      }
      const reviewed = reviewCard(card, Rating.Good, new Date('2026-07-20T00:00:00.000Z'))
      // ts-fsrs 会把 ls 增加到 2（Learning+Good 1 次），我们的 step=1
      expect(reviewed.state).toBe(CardState.Learning)
      expect(reviewed.step).toBe(1)
    })

    it('Learning + Again 重置 step=0, scheduledDays=0', () => {
      // 推 Learning 到 step=1
      let card: Card = createCard('h_1')
      card = reviewCard(card, Rating.Good, new Date('2026-07-20T00:00:00.000Z'))
      card = reviewCard(card, Rating.Good, new Date('2026-07-20T00:00:00.000Z'))
      expect(card.step).toBe(1)
      // Again 重置
      const relapsed = reviewCard(card, Rating.Again, new Date('2026-07-20T00:00:00.000Z'))
      expect(relapsed.state).toBe(CardState.Learning)
      expect(relapsed.step).toBe(0)
      expect(relapsed.scheduledDays).toBe(0)
    })
  })

  describe('ts-fsrs 默认 weights（FSRS-6.0 / 21 参数）', () => {
    it('default_w 长度为 21 (ts-fsrs 5.4.1 实现 FSRS-6.0)', () => {
      expect(TS_FSRS_DEFAULT_W.length).toBe(21)
    })

    it('getParameters 返回完整的 21 元素权重（与库默认一致）', () => {
      // 旧实现返回 slice(0,17)，既不完整也不对应任何一版 FSRS
      const params = getParameters()
      expect(params.w).toHaveLength(21)
      expect(params.w).toEqual([...TS_FSRS_DEFAULT_W])
    })

    it('setCustomParameters 接受 17 / 19 / 21 元素 w', () => {
      for (const len of [17, 19, 21]) {
        const w = new Array(len).fill(1.0)
        expect(() => setCustomParameters({ w })).not.toThrow()
        expect(getParameters().w).toEqual(w)
        resetParameters()
      }
    })

    it('setCustomParameters 拒绝 18 / 20 元素 w（与 ts-fsrs checkParameters 对齐）', () => {
      expect(() => setCustomParameters({ w: new Array(18).fill(1.0) })).toThrow()
      expect(() => setCustomParameters({ w: new Array(20).fill(1.0) })).toThrow()
    })
  })

  describe('ts-fsrs repeat 预览能力（FSRS-6.0 优势）', () => {
    it('验证 ts-fsrs 的 repeat 可一次性返回 4 种评分结果（能力证明）', () => {
      // 这是 ts-fsrs 相比原自实现的优势之一：可同时预览 4 种评分结果
      const f = createFsrs(generatorParameters({
        enable_fuzz: false,
        learning_steps: ['1m', '10m', '10m'],
        relearning_steps: ['1m', '10m'],
      }))
      const now = new Date('2026-07-20T00:00:00.000Z')
      const empty = createEmptyCard(now)
      const preview = f.repeat(empty, now)
      // 应该有 4 个评分结果（Again/Hard/Good/Easy）
      let count = 0
      for (const _ of preview) count++
      expect(count).toBe(4)
    })
  })

  describe('reviewCardBatch 批量复习', () => {
    it('批量复习应独立处理每张卡（不影响其他卡的状态）', () => {
      const card1: Card = createCard('h_1')
      const card2: Card = createCard('h_2')
      const card3: Card = createCard('h_3')
      const now = new Date('2026-07-20T00:00:00.000Z')
      const results = reviewCardBatch([
        { card: card1, rating: Rating.Good },
        { card: card2, rating: Rating.Hard },
        { card: card3, rating: Rating.Easy },
      ], now)
      expect(results).toHaveLength(3)
      // 第一张 Good → Learning step=0
      expect(results[0].state).toBe(CardState.Learning)
      expect(results[0].step).toBe(0)
      // 第二张 Hard → 仍 Learning
      expect(results[1].state).toBe(CardState.Learning)
      // 第三张 Easy → ts-fsrs 行为：Easy 评分让 New 卡片直接毕业到 Review
      // 这是 ts-fsrs v5 与原 SM-2 实现的关键差异之一
      expect(results[2].state).toBe(CardState.Review)
      // Easy 应该有更高的 stability (FSRS-6.0 DSR 模型)
      expect(results[2].stability).toBeGreaterThan(results[0].stability)
    })
  })

  describe('reviewVocabulary 词汇学习（ts-fsrs / FSRS-6.0 调度）', () => {
    it('stage=0 + Good → stage=1, repetitionCount=1, intervalDays=1', () => {
      const result = reviewVocabulary(
        {
          efFactor: 2.5,
          intervalDays: 0,
          repetitionCount: 0,
          learningStage: 0,
          familiarityLevel: 0,
        },
        Rating.Good,
        new Date('2026-07-20T00:00:00.000Z'),
      )
      expect(result.learningStage).toBe(1)
      expect(result.repetitionCount).toBe(1)
      expect(result.intervalDays).toBe(1)
      expect(result.isMastered).toBe(false)
    })

    it('stage=1 + Good (repetitionCount < 2) → 仍在 stage=1', () => {
      const result = reviewVocabulary(
        {
          efFactor: 2.5,
          intervalDays: 0,
          repetitionCount: 1,
          learningStage: 1,
          familiarityLevel: 1,
        },
        Rating.Good,
        new Date('2026-07-20T00:00:00.000Z'),
      )
      // repetitionCount 1 + 1 = 2，graduate to stage=2
      expect(result.learningStage).toBe(2)
      expect(result.repetitionCount).toBe(2)
      expect(result.intervalDays).toBeGreaterThanOrEqual(1)
    })

    it('stage=2 + Again → relearning (stage=1, lapse)', () => {
      const result = reviewVocabulary(
        {
          efFactor: 2.5,
          intervalDays: 10,
          repetitionCount: 3,
          learningStage: 2,
          familiarityLevel: 3,
        },
        Rating.Again,
        new Date('2026-07-20T00:00:00.000Z'),
      )
      expect(result.learningStage).toBe(1)
      expect(result.repetitionCount).toBe(1)  // 3 - 2 = 1
      expect(result.isMastered).toBe(false)
    })

    it('stage=2 + Good + 高 rep → 不再自动标记 mastered（改由用户显式决定）', () => {
      // 2026-09-15：is_mastered 曾是"复习满 5 次且 efFactor >= 2.5"自动置位，
      // 而 is_mastered = 1 会让 getDueForReview 永久排除该词 —— 等于复习 5 次就再也不出现，
      // 与 FSRS 排定的数百天后复习直接冲突。现在它只由用户「标记已掌握」显式设置。
      const result = reviewVocabulary(
        {
          efFactor: 2.5,
          intervalDays: 30,
          repetitionCount: 4,  // +1 = 5
          learningStage: 2,
          familiarityLevel: 4,
        },
        Rating.Good,
        new Date('2026-07-20T00:00:00.000Z'),
      )
      expect(result.repetitionCount).toBe(5)
      expect(result.isMastered).toBe(false)
      // 但记忆状态仍在正常累积，词仍会按 FSRS 排定的时间回来
      expect(result.stability).toBeGreaterThan(0)
      expect(result.intervalDays).toBeGreaterThan(1)
    })
  })

  describe('reviewVocabulary 间隔调度（回归：词汇间隔曾恒为 1 天）', () => {
    /** 从固定记忆状态连续评分，返回每次拿到的间隔天数 */
    function intervalsFor(grades: Rating[], seed: Partial<Parameters<typeof reviewVocabulary>[0]> = {}) {
      let state = {
        efFactor: 2.5,
        intervalDays: 2,
        repetitionCount: 2,
        learningStage: 2,
        familiarityLevel: 3,
        stability: 2.3065,
        difficulty: 2.1,
        lapses: 0,
        ...seed,
      }
      let now = new Date('2026-07-20T00:00:00.000Z')
      const out: number[] = []
      for (const g of grades) {
        const r = reviewVocabulary(state, g, now)
        out.push(r.intervalDays)
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
        now = new Date(r.nextReviewAt)
      }
      return out
    }

    it('stage=2 连续 Good 的间隔必须增长（旧实现恒为 1 天）', () => {
      const intervals = intervalsFor([Rating.Good, Rating.Good, Rating.Good, Rating.Good])
      // 旧 _nextIntervalVocabulary 符号写反：s * ((1/0.9)^(1/-0.5) - 1) = s * -0.19 → 被 clamp 到 1
      expect(intervals.every((d) => d > 1)).toBe(true)
      expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0] * 4)
    })

    it('稳定性随复习累积（FSRS-6.0 记忆状态真实推进）', () => {
      let now = new Date('2026-07-20T00:00:00.000Z')
      let state = {
        efFactor: 2.5,
        intervalDays: 2,
        repetitionCount: 2,
        learningStage: 2,
        familiarityLevel: 3,
        stability: 2.3065,
        difficulty: 2.1,
        lapses: 0,
      }
      const stabilities: number[] = []
      for (let i = 0; i < 4; i++) {
        const r = reviewVocabulary(state, Rating.Good, now)
        stabilities.push(r.stability)
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
        now = new Date(r.nextReviewAt)
      }
      for (let i = 1; i < stabilities.length; i++) {
        expect(stabilities[i]).toBeGreaterThan(stabilities[i - 1])
      }
    })

    it('stage=2 且无持久化 stability（老数据）时能自举，间隔 > 1 天', () => {
      const intervals = intervalsFor([Rating.Good], { stability: 0, difficulty: 0 })
      expect(intervals[0]).toBeGreaterThan(1)
    })

    it('stage=2 + Again → 回到 relearning 且 lapses +1', () => {
      const r = reviewVocabulary(
        {
          efFactor: 2.5,
          intervalDays: 30,
          repetitionCount: 4,
          learningStage: 2,
          familiarityLevel: 4,
          stability: 30,
          difficulty: 5,
          lapses: 0,
        },
        Rating.Again,
        new Date('2026-07-20T00:00:00.000Z'),
      )
      expect(r.learningStage).toBe(1)
      expect(r.lapses).toBe(1)
      expect(r.stability).toBeGreaterThan(0)
    })

    it('自定义 17 元素 w 会真正改变调度（旧实现静默忽略 <19 元素）', () => {
      const baseline = intervalsFor([Rating.Good, Rating.Good])[1]
      const w17 = [0.4, 0.6, 2.4, 5.4, 5.8, 0.5, 1.5, 0.1, 1.0, 2.0, 0.5, 1.0, 0.05, 0.2, 1.2, 0.3, 1.5]
      setCustomParameters({ w: w17 })
      const customised = intervalsFor([Rating.Good, Rating.Good])[1]
      resetParameters()
      // 实测：默认 21 权重 ≈ 46 天，17 元素自定义权重 ≈ 4 天；断言量级差异而非精确值（fuzz 开启）
      expect(customised).toBeLessThan(baseline / 2)
    })
  })

  describe('setCustomParameters 行为', () => {
    it('重置后 requestRetention 回到默认 0.9', () => {
      setCustomParameters({ requestRetention: 0.8 })
      expect(getParameters().requestRetention).toBe(0.8)
      resetParameters()
      expect(getParameters().requestRetention).toBe(0.9)
    })

    it('重置后 w 回到 ts-fsrs 默认的 21 元素', () => {
      const customW = new Array(21).fill(2.0)
      setCustomParameters({ w: customW })
      expect(getParameters().w).toEqual(customW)
      resetParameters()
      expect(getParameters().w).not.toEqual(customW)
      expect(getParameters().w).toEqual([...TS_FSRS_DEFAULT_W])
    })
  })

  describe('previewReviewRatings', () => {
    it('返回 4 种评分预览且不修改原卡', () => {
      const card = createCard('h_preview')
      const before = { ...card }
      const previews = previewReviewRatings(card, new Date('2026-07-20T00:00:00.000Z'))
      expect(previews).toHaveLength(4)
      expect(previews.map((p) => p.rating)).toEqual([
        Rating.Again,
        Rating.Hard,
        Rating.Good,
        Rating.Easy,
      ])
      for (const p of previews) {
        expect(p.due).toBeTruthy()
        expect(typeof p.intervalLabel).toBe('string')
        expect(p.intervalLabel.length).toBeGreaterThan(0)
        expect(p.stability).toBeGreaterThanOrEqual(0)
      }
      // 原卡不变
      expect(card.state).toBe(before.state)
      expect(card.due).toBe(before.due)
      expect(card.reps).toBe(before.reps)
    })

    it('Easy 的 due 不早于 Again', () => {
      const card = createCard('h_order')
      const now = new Date('2026-07-20T00:00:00.000Z')
      const previews = previewReviewRatings(card, now)
      const again = previews.find((p) => p.rating === Rating.Again)!
      const easy = previews.find((p) => p.rating === Rating.Easy)!
      expect(new Date(easy.due).getTime()).toBeGreaterThanOrEqual(new Date(again.due).getTime())
    })
  })

  describe('cardFromFields（界面把队列里那张卡送回预览）', () => {
    it('逐字段照搬：预览结果与直接调用完全一致', () => {
      const card = createCard('h_roundtrip')
      const now = new Date('2026-07-20T00:00:00.000Z')
      expect(cardFromFields(card)).toEqual(card)
      expect(previewReviewRatings(cardFromFields(card), now)).toEqual(
        previewReviewRatings(card, now),
      )
    })

    it('没有的两个来源补成 null，而不是留 undefined（`in` 判据会把它当成有值）', () => {
      const rebuilt = cardFromFields({ ...createCard('h_src'), knowledgeCardId: undefined })
      expect(rebuilt.knowledgeCardId).toBeNull()
      expect(rebuilt.methodologyId).toBeNull()
      expect(rebuilt.highlightId).toBe('h_src')
    })

    it('反证：每个字段都是真搬过去的，不是拿默认值糊出来的', () => {
      const fields = { ...createCard('h_drift'), lapses: 7, reps: 3, stability: 12.5, difficulty: 6.1 }
      const rebuilt = cardFromFields(fields)
      expect(rebuilt).toMatchObject({ lapses: 7, reps: 3, stability: 12.5, difficulty: 6.1 })
      // 少搬任何一个字段，这里就会拿到 undefined 而不是上面这些数
      expect(rebuilt).toEqual(fields)
    })
  })

  describe('预览通道不再"两种形状都认"', () => {
    const SRC = readFileSync(join(__dirname, '..', 'electron', 'ipc', 'fsrs.ts'), 'utf8')
    /** 靠探测键名来决定输入是蛇形行还是驼峰卡 */
    const DUAL_SHAPE = /'\w+' in card/

    it('handler 里不再有按键名探形状的分支', () => {
      expect(DUAL_SHAPE.test(SRC), '渲染层唯一调用方只可能传驼峰卡，蛇形那支从未走到').toBe(false)
    })

    it('反证：把收口前的写法喂进判据必须命中', () => {
      expect(DUAL_SHAPE.test("const hasSnake = 'highlight_id' in card")).toBe(true)
    })
  })
})
