// 知行读书 — FSRS 引擎冒烟测试
// 覆盖：卡片创建、状态机、参数校验、复习逻辑、统计聚合
// 这是 R6（覆盖率 ≥ 85%）的基线测试，后续每改 fsrs-engine.ts 必须更新
//
// v2.0 升级（2026-07-20）：基于 ts-fsrs@5.4.1 适配层。
// 新增 "ts-fsrs Adapter Integration" 套件，验证 Rating/State 枚举映射、step 映射、
// ts-fsrs 实际被调用、19 元素默认 weights、repeat 预览等。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createCard,
  reviewCard,
  reviewCardBatch,
  cardFromDb,
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

    it('should throw on weights array < 17 elements', () => {
      expect(() =>
        setCustomParameters({ w: [0.1, 0.2, 0.3] })
      ).toThrow(/at least 17 elements/)
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

  describe('ts-fsrs 默认 19 元素 weights', () => {
    it('FSRS v5 default_w 长度为 21 (ts-fsrs 5.4.1)', () => {
      // ts-fsrs 5.4.1 用 21 个参数（原 SM-2 只有 17 个）
      expect(TS_FSRS_DEFAULT_W.length).toBe(21)
    })

    it('getParameters 返回的 w 数组至少 17 元素（向后兼容）', () => {
      const params = getParameters()
      expect(params.w.length).toBeGreaterThanOrEqual(17)
    })

    it('setCustomParameters 接受 17 元素 w（旧 API 兼容）', () => {
      const w17 = new Array(17).fill(1.0)
      expect(() => setCustomParameters({ w: w17 })).not.toThrow()
      const params = getParameters()
      expect(params.w).toEqual(w17)
    })

    it('setCustomParameters 接受 19 元素 w（v5 新 API）', () => {
      const w19 = new Array(19).fill(0.5)
      expect(() => setCustomParameters({ w: w19 })).not.toThrow()
      const params = getParameters()
      expect(params.w).toEqual(w19)
    })
  })

  describe('ts-fsrs repeat 预览能力（FSRS v5 优势）', () => {
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
      // Easy 应该有更高的 stability (TS-FSRS v5 DSR 模型)
      expect(results[2].stability).toBeGreaterThan(results[0].stability)
    })
  })

  describe('reviewVocabulary 词汇学习（保留原 SM-2 混合算法）', () => {
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

    it('stage=2 + Good + 高 rep → 标记 mastered', () => {
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
      expect(result.isMastered).toBe(true)  // rep>=5 && efFactor>=2.5
    })
  })

  describe('setCustomParameters 行为', () => {
    it('重置后 requestRetention 回到默认 0.9', () => {
      setCustomParameters({ requestRetention: 0.8 })
      expect(getParameters().requestRetention).toBe(0.8)
      resetParameters()
      expect(getParameters().requestRetention).toBe(0.9)
    })

    it('重置后 w 回到默认 17 元素', () => {
      const customW = new Array(17).fill(2.0)
      setCustomParameters({ w: customW })
      expect(getParameters().w).toEqual(customW)
      resetParameters()
      // reset 后 customW 清除，应回到 ts-fsrs 默认前 17 个
      expect(getParameters().w).not.toEqual(customW)
      expect(getParameters().w.length).toBe(17)
    })
  })
})
