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
  /** 书籍来源：'weread' = 微信读书同步（id 为 weread bookId），其他 = 本地导入（id 为 UUID） */
  source?: string
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

export interface RecommendationItem {
  bookId: string
  title: string
  author: string
  cover: string
  intro: string
  category: string
  rating?: number
  reason: string
}

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
  sources?: RagSourceRef[]
  createdAt: string
}

/**
 * 一处被检索命中的原文片段 —— 对话「引用来源」面板的数据单位。
 *
 * 2026-09-16 统一：此前**同一个形状在三处各写了一遍**
 * （本文件的 ChatMessage.sources、renderer 的 chatStore.Source、
 *  MessageBubble.RAGSource），而且字段名沿用 **Qdrant 时代的 chunkId** ——
 * Qdrant 早已从项目移除，现在的检索结果给的是 `highlightId`
 * （见 electron/services/rag-service.ts 的 SearchResult）。
 *
 * 「三处定义 + 一个已不存在的概念留下的字段名」，正是本项目反复出问题的那种组合，
 * 所以在这里只留一份，主进程与渲染层共用。
 */
export interface RagSourceRef {
  /** 命中的划线 id（Vectra 索引写入的 payload.highlightId） */
  highlightId: string
  bookId: string
  bookTitle: string
  /**
   * 命中的原文片段。
   * 声明为可选：这个类型也用于解析数据库里存的 JSON，
   * 历史上写入过的或格式不完整的数据不该让整个列表渲染不出来。
   * 由检索层新产生的数据一定带 content。
   */
  content?: string
  relevanceScore: number
  chapterTitle?: string
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
