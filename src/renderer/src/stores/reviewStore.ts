import { create } from 'zustand'
import { Card } from '../../../shared/types'

interface ReviewState {
  dueCards: Card[]
  currentIndex: number
  showAnswer: boolean
  completed: number
  loading: boolean
  error: string | null
  fetchDueCards: () => Promise<void>
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

  fetchDueCards: async () => {
    set({ loading: true, error: null })
    try {
      const dueCards = await window.electronAPI.card.getDue()
      set({ dueCards, currentIndex: 0, showAnswer: false, completed: 0, loading: false })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
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
        loading: false
      })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  }
}))
