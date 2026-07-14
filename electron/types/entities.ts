/**
 * 实体类型定义
 * 定义数据库表对应的 TypeScript 接口
 */

export interface Book {
  id: string
  title: string
  author?: string
  cover?: string
  isbn?: string
  publisher?: string
  publishDate?: string
  description?: string
  category?: string
  readingProgress: number
  totalChapter: number
  lastReadTime?: string
  isFinished: boolean
  createdAt: string
  updatedAt: string
}

export interface Highlight {
  id: string
  bookId: string
  chapterTitle?: string
  content: string
  note?: string
  style: number
  rangeStart?: string
  rangeEnd?: string
  createdAt: string
  updatedAt: string
  // 关联字段
  bookTitle?: string
}

export interface Card {
  id: string
  highlightId: string
  state: number
  step: number
  stability: number
  difficulty: number
  due: string
  lastReview: string | null
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  applicationTag?: string
  masteryLevel?: number
  createdAt?: string
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
  toolsUsed?: string
  bloomLevel?: number
  masteryAssessment?: string
  sources?: string
  createdAt: string
}

export interface Methodology {
  id: string
  bookId: string
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string
  outputFormat?: string
  examples?: string
  tags?: string
  sourceHighlightIds?: string
  masteryLevel: number
  practiceCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCard {
  id: string
  bookId: string
  type: 'concept' | 'methodology' | 'quote'
  title: string
  content: string
  interpretation?: string
  application?: string
  relatedCardIds?: string
  tags?: string
  sourceHighlightId?: string
  reviewCount: number
  masteryLevel: number
  createdAt: string
  updatedAt: string
}

export interface Memory {
  id: string
  type: 'preference' | 'insight' | 'interaction' | 'achievement'
  category: string
  content: string
  importance: number
  context?: string
  accessCount: number
  createdAt: string
  lastAccessedAt: string
}

export interface Vocabulary {
  id: string
  word: string
  phonetic?: string
  partOfSpeech?: string
  meaningZh: string
  exampleEn?: string
  exampleZh?: string
  cefrLevel?: string
  sourceArticleId?: string
  source: string
  isMastered: boolean
  reviewCount: number
  lastReviewAt?: string
  nextReviewAt?: string
  efFactor: number
  intervalDays: number
  repetitionCount: number
  familiarityLevel: number
  learningStage: number
  createdAt: string
}

export interface Article {
  id: string
  titleEn: string
  titleZh?: string
  contentEn: string
  contentZh?: string
  summaryZh?: string
  source: string
  sourceUrl?: string
  category: string
  difficulty: string
  vocabularyJson?: string
  isRead: boolean
  isFavorite: boolean
  readTime: number
  createdAt: string
  publishedAt?: string
  sourceWebsite?: string
}

export interface BookArchitecture {
  id: string
  bookId: string
  coreProposition?: string
  cognitiveFramework?: string
  methodologyArchitecture?: string
  knowledgeHierarchy?: string
  targetAudience?: string
  createdAt: string
  updatedAt: string
}

export interface BookSummary {
  id: string
  bookId: string
  summary: string
  keyPoints?: string
  generatedAt: string
}

export interface DailyStats {
  id: string
  date: string
  booksRead: number
  highlightsAdded: number
  cardsReviewed: number
  readingTime: number
  createdAt: string
}

export interface TokenUsage {
  id: string
  provider: string
  model: string
  feature: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  durationMs: number
  createdAt: string
}
