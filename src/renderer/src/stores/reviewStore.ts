import { create } from 'zustand'
import type { DueReviewCard } from '../../../types/renderer'

/** 四种评分对应的下次复习间隔预览 */
export interface RatingPreview {
  rating: number
  due: string
  scheduledDays: number
  state: number
  stability: number
  intervalLabel: string
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

  fetchDueCards: async () => {
    set({ loading: true, error: null })
    try {
      const dueCards = await window.electronAPI.card.getDueWithContent(100)
      set({ dueCards, currentIndex: 0, showAnswer: false, completed: 0, loading: false, previews: [] })
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
      await window.electronAPI.card.review(currentCard.id, rating)

      const nextIndex = currentIndex + 1
      const isCompleted = nextIndex >= dueCards.length

      set({
        currentIndex: isCompleted ? currentIndex : nextIndex,
        showAnswer: false,
        completed: completed + 1,
        loading: false,
        previews: [],
      })
      if (!isCompleted) {
        await get().loadPreviews()
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  }
}))
