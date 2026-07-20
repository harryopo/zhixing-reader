// 知行读书 — FSRS 引擎冒烟测试
// 覆盖：卡片创建、状态机、参数校验、复习逻辑、统计聚合
// 这是 R6（覆盖率 ≥ 85%）的基线测试，后续每改 fsrs-engine.ts 必须更新

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createCard,
  reviewCard,
  cardFromDb,
  cardToRow,
  getParameters,
  setCustomParameters,
  resetParameters,
  calculateStats,
  isDue,
  getCardRetentionRate,
  CardState,
  Rating,
  type Card,
} from '../electron/fsrs-engine'

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
