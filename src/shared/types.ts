import type { ActivityDay } from './profile-stats'

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

/** 全书摘要（层级摘要 L2）—— 与 book_summaries 表的实际列一一对应 */
export interface BookSummary {
  id: string
  bookId: string
  summary: string
  /** keyPoints 数组的 JSON 字符串，模型没给就是 null */
  keyPoints: string | null
  generatedAt: string
}

/** 章节摘要（层级摘要 L1）—— 与 chapter_summaries 表的实际列一一对应 */
export interface ChapterSummary {
  id: string
  bookId: string
  chapterTitle: string
  summary: string
  /** 这条摘要基于该章多少条划线；划线数变了才需要重生成 */
  sourceCount: number
  generatedAt: string
}

/** 一次「生成层级摘要」的结果统计，界面按它说人话 */
export interface BookSummaryRunResult {
  bookTitle: string
  generated: number
  skipped: number
  failed: number
  bookSummary: boolean
}

/** 通知面板的一条「这本书欠摘要」，pendingChapters 就是点进去会重做的章节数 */
export interface PendingSummaryEntry {
  bookId: string
  title: string
  pendingChapters: number
}

/**
 * daily_stats 表的一行原样。
 * sql.js 的 `SELECT *` 交出来就是列名（下划线），界面别直接读 ——
 * 先过 `profile-stats.normalizeDailyStatRow`，它同时兼容历史 camelCase 写法。
 */
export interface DailyStatsRow {
  id: string
  date: string
  books_read: number
  highlights_added: number
  cards_reviewed: number
  reading_time: number
  created_at: string
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

/**
 * 档案页的学习统计。
 * 只放「取到哪就是哪」的计数，逐日明细交给 dailyRows ——
 * 时长/日均/连击一律由 `src/shared/profile-stats.ts` 现算，界面不许自己再算一遍
 * （原先 totalReadingTime + averageDailyReadingTime 两份预算结果，
 *  正是「年度阅读 0h」配「日均 6min」这种自相矛盾的来源）。
 */
export interface LearningStats {
  totalBooks: number
  finishedBooks: number
  totalHighlights: number
  totalCards: number
  masteredCards: number
  /** 复习次数（reviews 表条数） */
  totalReviews: number
  /** 这些次复习覆盖了几张不同的卡 */
  reviewedCards: number
  /** 最近一次复习时间，'YYYY-MM-DD HH:MM:SS'；一次都没复习过是 null */
  lastReviewAt: string | null
  currentStreak: number
  longestStreak: number
  /** 今年 1 月 1 日到今天的逐日明细（已归一化） */
  dailyRows: ActivityDay[]
  /** 库里最早一条书/划线记录的日期时间 —— 「用了多久」只能由它说，不许拿今天的日期倒推一个 */
  firstRecordAt: string | null
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

