import { create } from 'zustand'
import { LearningStats, Achievement, DailyReadingData, LearningMilestone, Book, DailyStats as _DailyStats } from '../../../shared/types'

interface ProfileState {
  stats: LearningStats
  achievements: Achievement[]
  milestones: LearningMilestone[]
  loading: boolean
  error: string | null
  fetchStats: () => Promise<void>
  checkAchievements: () => Promise<void>
  getWeeklyData: () => Promise<void>
  getMonthlyData: () => Promise<void>
}

const defaultStats: LearningStats = {
  totalBooks: 0,
  finishedBooks: 0,
  totalHighlights: 0,
  totalCards: 0,
  masteredCards: 0,
  totalReviews: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalReadingTime: 0,
  averageDailyReadingTime: 0,
  weeklyReadingData: [],
  monthlyReadingData: [],
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
  milestones: [],
  loading: false,
  error: null,

  fetchStats: async () => {
    set({ loading: true, error: null })
    try {
      const books = await window.electronAPI.book.getAll()
      const highlights = await window.electronAPI.highlight.getAll()
      const cards = await window.electronAPI.card.getStats()
      const reviews = await window.electronAPI.review.getRecent(1000)
      const dailyStats = await window.electronAPI.stats.getRange(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      )

      const totalBooks = books.length
      const finishedBooks = books.filter((b: Book) => {
        const row = b as unknown as Record<string, unknown>
        return (row.reading_progress as number) >= 1 || (row.is_finished as number) === 1
      }).length
      const totalHighlights = highlights.length
      // Backend getReviewStats: { total, due, new, learning, review } — not totalCards/masteredCards
      const cardStats = cards as unknown as Record<string, number>
      const totalCards = cardStats.total ?? cardStats.totalCards ?? 0
      // Approximate mastered as review-state cards (state=2); no separate mastered field
      const masteredCards = cardStats.review ?? cardStats.masteredCards ?? 0
      const totalReviews = reviews.length

      let totalReadingTime = 0
      const weeklyReadingData: DailyReadingData[] = []
      const monthlyReadingData: DailyReadingData[] = []

      for (const stat of dailyStats) {
        const row = stat as unknown as Record<string, unknown>
        const date = String(row.date ?? '')
        // daily_stats columns are snake_case from sql.js rowsToObjects
        const readingTime = Number(row.reading_time ?? row.readingTime ?? 0)
        const highlightsCount = Number(row.highlights_added ?? row.highlightsCount ?? 0)
        const reviewsCount = Number(row.cards_reviewed ?? row.reviewsCount ?? 0)
        const booksRead = Number(row.books_read ?? 0)

        totalReadingTime += readingTime

        const data: DailyReadingData = {
          date,
          readingTime,
          highlightsCount,
          reviewsCount,
          booksRead,
        }

        const daysDiff = Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000))
        if (daysDiff < 7) {
          weeklyReadingData.push(data)
        }
        monthlyReadingData.push(data)
      }

      const daysWithData = dailyStats.length || 1
      const averageDailyReadingTime = Math.round(totalReadingTime / daysWithData)

      let currentStreak = 0

      const sortedDates = dailyStats
        .map((s) => s.date)
        .sort()
        .reverse()

      // 当前连击：以今天结尾的连续阅读天数，遇到断档即止
      for (let i = 0; i < sortedDates.length; i++) {
        const currentDate = new Date(sortedDates[i])
        const expectedDate = new Date()
        expectedDate.setDate(expectedDate.getDate() - i)

        if (currentDate.toISOString().split('T')[0] === expectedDate.toISOString().split('T')[0]) {
          currentStreak++
        } else {
          break
        }
      }

      // 最长连击：历史日期中的最大连续段（独立于"今天"锚点）
      let longestStreak = 0
      const uniqueDays = Array.from(new Set(dailyStats.map((s) => String(s.date).slice(0, 10))))
        .filter((d) => d.length === 10)
        .sort()
      let runLength = 0
      let prevDayMs = Number.NaN
      for (const day of uniqueDays) {
        const dayMs = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
        runLength = dayMs - prevDayMs === 86400000 ? runLength + 1 : 1
        longestStreak = Math.max(longestStreak, runLength)
        prevDayMs = dayMs
      }

      set({
        stats: {
          totalBooks,
          finishedBooks,
          totalHighlights,
          totalCards,
          masteredCards,
          totalReviews,
          currentStreak,
          longestStreak,
          totalReadingTime,
          averageDailyReadingTime,
          weeklyReadingData,
          monthlyReadingData,
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

  getWeeklyData: async () => {
    try {
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const dailyStats = await window.electronAPI.stats.getRange(startDate, endDate)

      const weeklyData: DailyReadingData[] = dailyStats.map((stat) => ({
        date: stat.date,
        readingTime: stat.readingTime || 0,
        highlightsCount: stat.highlightsCount || 0,
        reviewsCount: stat.reviewsCount || 0,
        booksRead: 0,
      }))

      set((state) => ({
        stats: { ...state.stats, weeklyReadingData: weeklyData },
      }))
    } catch (error) {
      console.error('Failed to fetch weekly data:', error)
    }
  },

  getMonthlyData: async () => {
    try {
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const dailyStats = await window.electronAPI.stats.getRange(startDate, endDate)

      const monthlyData: DailyReadingData[] = dailyStats.map((stat) => ({
        date: stat.date,
        readingTime: stat.readingTime || 0,
        highlightsCount: stat.highlightsCount || 0,
        reviewsCount: stat.reviewsCount || 0,
        booksRead: 0,
      }))

      set((state) => ({
        stats: { ...state.stats, monthlyReadingData: monthlyData },
      }))
    } catch (error) {
      console.error('Failed to fetch monthly data:', error)
    }
  },
}))
