export interface Book {
  id: string
  title: string
  author: string
  cover: string
  publisher?: string
  isbn?: string
  description?: string
  category?: string
  tags?: string[]
  progress: number
  lastReadAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface Highlight {
  id: string
  bookId: string
  chapterId?: string
  content: string
  note?: string
  color: string
  pageNumber?: number
  position: {
    start: number
    end: number
  }
  createdAt: Date
  updatedAt: Date
}

export interface Card {
  id: string
  bookId: string
  highlightId?: string
  question: string
  answer: string
  tags?: string[]
  difficulty: 'easy' | 'medium' | 'hard'
  nextReviewAt: Date
  reviewCount: number
  lastReviewAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Review {
  id: string
  cardId: string
  quality: number
  easeFactor: number
  interval: number
  reviewedAt: Date
}

export interface BookSummary {
  id: string
  bookId: string
  content: string
  keyPoints: string[]
  createdAt: Date
  updatedAt: Date
}

export interface DailyStats {
  date: string
  readingTime: number
  pagesRead: number
  highlightsCount: number
  reviewsCount: number
}

export interface ReviewStats {
  totalCards: number
  masteredCards: number
  learningCards: number
  newCards: number
  averageEase: number
  retentionRate: number
}

export interface IPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type Theme = 'light' | 'dark' | 'system'

export interface UserPreferences {
  theme: Theme
  fontSize: number
  fontFamily: string
  lineHeight: number
  readingGoal: number
  language: 'zh-CN' | 'en-US'
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  category: 'reading' | 'notes' | 'review' | 'streak'
  condition: (stats: LearningStats) => boolean
  unlockedAt?: Date
}

export interface LearningStats {
  totalBooks: number
  finishedBooks: number
  totalHighlights: number
  totalCards: number
  masteredCards: number
  totalReviews: number
  currentStreak: number
  longestStreak: number
  totalReadingTime: number
  averageDailyReadingTime: number
  weeklyReadingData: DailyReadingData[]
  monthlyReadingData: DailyReadingData[]
}

export interface DailyReadingData {
  date: string
  readingTime: number
  highlightsCount: number
  reviewsCount: number
  booksRead: number
}

export interface ReadLongestItem {
  book?: {
    bookId: string
    title: string
    author: string
    cover: string
    [key: string]: unknown
  }
  albumInfo?: Record<string, unknown>
  readTime: number
  recordReadingTime?: number
  tags?: string[]
}

export interface ReadingDataBook {
  bookId: string
  title: string
  author: string
  cover: string
  readTime: number
  recordReadingTime?: number
  tags?: string[]
}

export interface ReadingStatItem {
  stat: string
  counts: string
  scheme?: string
}

export interface PreferCategory {
  categoryId: string
  categoryTitle: string
  parentCategoryId?: string
  parentCategoryTitle?: string
  val: number
  readingTime: number
  readingCount: number
  categoryType?: number
}

export interface PreferAuthor {
  authorId: string
  name: string
  count: number
  readTime: string
}

export interface ReadingDataResponse {
  baseTime: number
  readTimes?: Record<string, number>
  dailyReadTimes?: Record<string, number>
  readDays: number
  totalReadTime: number
  dayAverageReadTime: number
  compare?: number
  readLongest?: ReadLongestItem[]
  readStat?: ReadingStatItem[]
  preferCategory?: PreferCategory[]
  preferCategoryWord?: string
  preferTime?: number[]
  preferTimeWord?: string
  preferAuthor?: PreferAuthor[]
  authorCount?: number
  readRate?: number
  wrReadTime?: number
  wrListenTime?: number
  rank?: { text: string; scheme?: string }
  registTime?: number
}

export type ReadingMode = 'weekly' | 'monthly' | 'annually' | 'overall'

export interface LearningMilestone {
  id: string
  title: string
  description: string
  achievedAt: Date
  type: 'book' | 'highlight' | 'review' | 'streak'
  value: number
}

export interface LearningReport {
  period: 'week' | 'month' | 'year'
  startDate: string
  endDate: string
  stats: LearningStats
  topBooks: BookSummary[]
  achievements: Achievement[]
  recommendations: string[]
}

export interface Conversation {
  id: string
  title: string
  bookId?: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  intent?: string
  toolsUsed?: string[]
  bloomLevel?: number
  masteryAssessment?: {
    concept: string
    level: number
    confidence: number
  }
  sources?: Array<{
    bookId: string
    bookTitle: string
    chunkId: string
    relevanceScore: number
  }>
  createdAt: string
}

export type CardType = 'concept' | 'methodology' | 'quote'

export interface Methodology {
  id: string
  bookId: string
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string[]
  outputFormat?: string
  examples?: string
  tags?: string[]
  sourceHighlightIds?: string[]
  masteryLevel: number
  practiceCount: number
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeCard {
  id: string
  bookId: string
  type: CardType
  title: string
  content: string
  interpretation?: string
  application?: string
  relatedCardIds?: string[]
  tags?: string[]
  sourceHighlightId?: string
  reviewCount: number
  masteryLevel: number
  createdAt: Date
  updatedAt: Date
}

export interface BookArchitecture {
  id: string
  bookId: string
  coreProposition?: string
  cognitiveFramework?: Record<string, unknown>
  methodologyArchitecture?: Record<string, unknown>
  knowledgeHierarchy?: Record<string, unknown>
  targetAudience?: string
  createdAt: Date
  updatedAt: Date
}
