import { create } from 'zustand'
import type { LearningStats, Achievement } from '../../../shared/types'
import { mapBooks, mapHighlights } from '../utils/db-mapper'
import {
  statsWindow,
  localDateStr,
  normalizeDailyStatRow,
  computeStreaks,
  summarizeReviews,
  type ActivityDay,
} from '../../../shared/profile-stats'

interface ProfileState {
  stats: LearningStats
  achievements: Achievement[]
  loading: boolean
  error: string | null
  fetchStats: () => Promise<void>
  checkAchievements: () => Promise<void>
}

const defaultStats: LearningStats = {
  totalBooks: 0,
  finishedBooks: 0,
  totalHighlights: 0,
  totalCards: 0,
  masteredCards: 0,
  totalReviews: 0,
  reviewedCards: 0,
  lastReviewAt: null,
  currentStreak: 0,
  longestStreak: 0,
  dailyRows: [],
  firstRecordAt: null,
}

const defaultAchievements: Achievement[] = [
  {
    id: 'first_book',
    name: '初读书籍',
    description: '完成第一本书的阅读',
    icon: '📚',
    category: 'reading',
    condition: (stats) => stats.finishedBooks >= 1,
  },
  {
    id: 'bookworm',
    name: '书虫',
    description: '完成10本书的阅读',
    icon: '🐛',
    category: 'reading',
    condition: (stats) => stats.finishedBooks >= 10,
  },
  {
    id: 'scholar',
    name: '学者',
    description: '完成50本书的阅读',
    icon: '🎓',
    category: 'reading',
    condition: (stats) => stats.finishedBooks >= 50,
  },
  {
    id: 'first_highlight',
    name: '初次标记',
    description: '创建第一条笔记',
    icon: '✨',
    category: 'notes',
    condition: (stats) => stats.totalHighlights >= 1,
  },
  {
    id: 'note_taker',
    name: '笔记达人',
    description: '创建100条笔记',
    icon: '📝',
    category: 'notes',
    condition: (stats) => stats.totalHighlights >= 100,
  },
  {
    id: 'highlight_master',
    name: '标记大师',
    description: '创建500条笔记',
    icon: '🏆',
    category: 'notes',
    condition: (stats) => stats.totalHighlights >= 500,
  },
  {
    id: 'first_review',
    name: '初次复习',
    description: '完成第一次复习',
    icon: '🔄',
    category: 'review',
    condition: (stats) => stats.totalReviews >= 1,
  },
  {
    id: 'reviewer',
    name: '复习达人',
    description: '完成100次复习',
    icon: '📊',
    category: 'review',
    condition: (stats) => stats.totalReviews >= 100,
  },
  {
    id: 'memory_master',
    name: '记忆大师',
    description: '掌握100张卡片',
    icon: '🧠',
    category: 'review',
    condition: (stats) => stats.masteredCards >= 100,
  },
  {
    id: 'streak_3',
    name: '三日坚持',
    description: '连续学习3天',
    icon: '🔥',
    category: 'streak',
    condition: (stats) => stats.currentStreak >= 3,
  },
  {
    id: 'streak_7',
    name: '一周坚持',
    description: '连续学习7天',
    icon: '💪',
    category: 'streak',
    condition: (stats) => stats.currentStreak >= 7,
  },
  {
    id: 'streak_30',
    name: '月度坚持',
    description: '连续学习30天',
    icon: '🌟',
    category: 'streak',
    condition: (stats) => stats.currentStreak >= 30,
  },
]

export const useProfileStore = create<ProfileState>((set, get) => ({
  stats: defaultStats,
  achievements: defaultAchievements,
  loading: false,
  error: null,

  fetchStats: async () => {
    set({ loading: true, error: null })
    try {
      const now = new Date()
      // 一次取数覆盖「今年至今」+「26 周热力图」两个窗口，别嘴上说年度、手上取 30 天
      const { start, end } = statsWindow(now)

      const [booksRaw, highlightsRaw, cards, reviews, range] = await Promise.all([
        window.electronAPI.book.getAll(),
        window.electronAPI.highlight.getAll(),
        window.electronAPI.card.getStats(),
        window.electronAPI.review.getRecent(1000),
        window.electronAPI.stats.getRange(start, end),
      ])

      const books = mapBooks(booksRaw as unknown[])
      const highlights = mapHighlights(highlightsRaw as unknown[])
      const totalBooks = books.length
      const finishedBooks = books.filter((b) => b.progress >= 1 || b.isFinished === 1).length
      const totalHighlights = highlights.length
      const totalCards = cards.total
      // 本项目没有独立的"已掌握"字段，state=2（review 态）即已学过并进入排期
      const masteredCards = cards.review

      const reviewSummary = summarizeReviews(reviews ?? [])
      const dailyRows = (range ?? [])
        .map((r) => normalizeDailyStatRow(r))
        .filter((r): r is ActivityDay => r !== null)
      const { current, longest } = computeStreaks(dailyRows, localDateStr(now))
      const stamps = [...books, ...highlights]
        .map((r) => r.createdAt)
        .filter((s) => s.length >= 10)
        .sort()
      const firstRecordAt = stamps[0] ?? null

      set({
        stats: {
          totalBooks,
          finishedBooks,
          totalHighlights,
          totalCards,
          masteredCards,
          totalReviews: reviewSummary.times,
          reviewedCards: reviewSummary.cardsCovered,
          lastReviewAt: reviewSummary.lastAt,
          currentStreak: current,
          longestStreak: longest,
          dailyRows,
          firstRecordAt,
        },
        loading: false,
      })

      await get().checkAchievements()
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  checkAchievements: async () => {
    const { stats, achievements } = get()
    
    let savedUnlocks: Record<string, string> = {}
    try {
      const saved = await window.electronAPI.settings.get('achievementUnlocks')
      if (saved && typeof saved === 'object') {
        savedUnlocks = saved as Record<string, string>
      }
    } catch {}
    
    let hasNewUnlocks = false
    const updatedAchievements = achievements.map((achievement) => {
      if (savedUnlocks[achievement.id]) {
        return { ...achievement, unlockedAt: new Date(savedUnlocks[achievement.id]) }
      }
      
      if (achievement.condition(stats)) {
        savedUnlocks[achievement.id] = new Date().toISOString()
        hasNewUnlocks = true
        return { ...achievement, unlockedAt: new Date() }
      }
      return achievement
    })
    
    if (hasNewUnlocks) {
      await window.electronAPI.settings.set('achievementUnlocks', savedUnlocks)
    }
    
    set({ achievements: updatedAchievements })
  },

}))
