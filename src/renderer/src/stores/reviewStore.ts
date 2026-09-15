import { create } from 'zustand'
import type { DueReviewCard } from '../../../types/renderer'
import { getCardMastery, type MasteryLevel } from '../../../shared/fsrs-metrics'

/** 四种评分对应的下次复习间隔预览 */
export interface RatingPreview {
  rating: number
  due: string
  scheduledDays: number
  state: number
  stability: number
  intervalLabel: string
}

/** 单张卡片评分前后的掌握度变化（评分后即时反馈用） */
export interface MasteryDelta {
  cardId: string
  before: number
  after: number
  levelBefore: MasteryLevel
  levelAfter: MasteryLevel
}

/** 本轮复习的真实累计统计（不使用任何估算值） */
export interface RoundStats {
  /** 本轮已评分的卡片数 */
  reviewed: number
  /** 本轮所有卡片「复习前稳定性」之和（天） */
  stabilityBeforeSum: number
  /** 本轮所有卡片「复习后稳定性」之和（天） */
  stabilityAfterSum: number
  /** 掌握度上升 / 下降 / 持平的张数 */
  improved: number
  declined: number
  unchanged: number
}

const EMPTY_ROUND: RoundStats = {
  reviewed: 0,
  stabilityBeforeSum: 0,
  stabilityAfterSum: 0,
  improved: 0,
  declined: 0,
  unchanged: 0,
}

/**
 * 取一张卡片的掌握度。
 * 入参整体可空：IPC 返回异常负载（如 `{ reviewId, card: undefined }`）时
 * 不能让整个复习流程因为一个展示指标而抛错。
 */
function masteryOf(
  card?: { stability?: number; difficulty?: number; reps?: number; lapses?: number } | null,
): { score: number; level: MasteryLevel } {
  const m = getCardMastery({
    stability: card?.stability ?? 0,
    difficulty: card?.difficulty ?? 0,
    reps: card?.reps ?? 0,
    lapses: card?.lapses ?? 0,
  })
  return { score: m.score, level: m.level }
}

interface ReviewState {
  dueCards: DueReviewCard[]
  currentIndex: number
  showAnswer: boolean
  completed: number
  loading: boolean
  error: string | null
  /** 当前卡片的四种评分间隔预览（忘记/困难/良好/简单） */
  previews: RatingPreview[]
  /** 最近一次评分造成的掌握度变化 */
  lastMasteryDelta: MasteryDelta | null
  /** 本轮累计统计 */
  roundStats: RoundStats
  fetchDueCards: () => Promise<void>
  loadPreviews: () => Promise<void>
  showAnswerCard: () => void
  rateCard: (rating: number) => Promise<void>
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  dueCards: [],
  currentIndex: 0,
  showAnswer: false,
  completed: 0,
  loading: false,
  error: null,
  previews: [],
  lastMasteryDelta: null,
  roundStats: { ...EMPTY_ROUND },

  fetchDueCards: async () => {
    set({ loading: true, error: null })
    try {
      const dueCards = await window.electronAPI.card.getDueWithContent(100)
      set({
        dueCards,
        currentIndex: 0,
        showAnswer: false,
        completed: 0,
        loading: false,
        previews: [],
        lastMasteryDelta: null,
        roundStats: { ...EMPTY_ROUND },
      })
      await get().loadPreviews()
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  /** 拉取当前卡片在四种评分下的下次间隔预览（不落库） */
  loadPreviews: async () => {
    const { dueCards, currentIndex } = get()
    const card = dueCards[currentIndex]
    if (!card) {
      set({ previews: [] })
      return
    }
    try {
      const previews = await window.electronAPI.fsrs.previewReviewRatings(card as unknown as Record<string, unknown>)
      set({ previews })
    } catch {
      // 预览失败不影响复习主流程，按钮退化为无间隔标签
      set({ previews: [] })
    }
  },

  showAnswerCard: () => {
    set({ showAnswer: true })
  },

  rateCard: async (rating: number) => {
    const { dueCards, currentIndex, completed } = get()
    const currentCard = dueCards[currentIndex]

    if (!currentCard) return

    set({ loading: true, error: null })
    try {
      // 评分前掌握度：由当前 FSRS 状态推导
      const before = masteryOf(currentCard)

      // 主进程返回 { reviewId, card }，card 是调度后的新状态
      const { card: updated } = await window.electronAPI.card.review(currentCard.id, rating)

      const after = masteryOf(updated)
      const stats = get().roundStats
      const trend = after.score > before.score ? 'up' : after.score < before.score ? 'down' : 'same'

      const nextIndex = currentIndex + 1
      const isCompleted = nextIndex >= dueCards.length

      set({
        currentIndex: isCompleted ? currentIndex : nextIndex,
        showAnswer: false,
        completed: completed + 1,
        loading: false,
        previews: [],
        lastMasteryDelta: {
          cardId: currentCard.id,
          before: before.score,
          after: after.score,
          levelBefore: before.level,
          levelAfter: after.level,
        },
        roundStats: {
          reviewed: stats.reviewed + 1,
          stabilityBeforeSum: stats.stabilityBeforeSum + Math.max(0, currentCard.stability ?? 0),
          stabilityAfterSum: stats.stabilityAfterSum + Math.max(0, updated?.stability ?? 0),
          improved: stats.improved + (trend === 'up' ? 1 : 0),
          declined: stats.declined + (trend === 'down' ? 1 : 0),
          unchanged: stats.unchanged + (trend === 'same' ? 1 : 0),
        },
      })
      if (!isCompleted) {
        await get().loadPreviews()
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  }
}))
