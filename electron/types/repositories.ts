/**
 * Repository 接口定义
 * 定义数据访问层的抽象接口，遵循 Repository 模式
 */

import {
  Book,
  Highlight,
  Card,
  Conversation,
  ChatMessage,
  Methodology,
  KnowledgeCard,
  Memory,
  Vocabulary,
  Article,
  BookArchitecture,
  BookSummary,
  DailyStats,
  TokenUsage,
} from './entities'

// ============================================================================
// 基础 Repository 接口
// ============================================================================

/**
 * 基础 Repository 接口，提供通用的 CRUD 操作
 */
export interface IBaseRepository<T, K = string> {
  findById(id: K): T | null
  findAll(): T[]
  create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): T
  update(id: K, updates: Partial<T>): void
  delete(id: K): void
  deleteBatch(ids: K[]): void
  count(): number
}

// ============================================================================
// 书籍 Repository
// ============================================================================

export interface IBookRepository extends IBaseRepository<Book> {
  findByStatus(status: string): Book[]
  findRecent(limit?: number): Book[]
  search(keyword: string): Book[]
  updateProgress(id: string, progress: number): void
  createBatch(books: Array<Partial<Book>>): void
}

// ============================================================================
// 高亮 Repository
// ============================================================================

export interface IHighlightRepository extends IBaseRepository<Highlight> {
  findByBookId(bookId: string): Highlight[]
  findRecent(limit?: number): Highlight[]
  search(keyword: string): Highlight[]
  existsByContent(bookId: string, content: string): boolean
  createBatch(highlights: Array<Partial<Highlight>>): number
  deleteByBookId(bookId: string): void
  countByBookId(bookId: string): number
}

// ============================================================================
// 卡片 Repository
// ============================================================================

export interface ICardRepository extends IBaseRepository<Card> {
  findByHighlightId(highlightId: string): Card | null
  findByBookId(bookId: string): Card[]
  findDueCards(limit?: number): Card[]
  findByState(state: number, limit?: number): Card[]
  findNewCards(limit?: number): Card[]
  findLearningCards(limit?: number): Card[]
  createBatch(highlightIds: string[]): Card[]
  updateBatch(cards: Card[]): void
  deleteByHighlightId(highlightId: string): void
  createForExistingHighlights(): { created: number; skipped: number }
  getReviewStats(): { total: number; due: number; new: number; learning: number; review: number }
  updateApplicationTag(id: string, tag: string): void
  updateMasteryLevel(id: string, level: number): void
}

// ============================================================================
// 对话 Repository
// ============================================================================

export interface IConversationRepository extends IBaseRepository<Conversation> {
  findByBookId(bookId: string): Conversation[]
  findRecent(limit?: number): Conversation[]
  updateMessageCount(id: string, count: number): void
}

// ============================================================================
// 聊天消息 Repository
// ============================================================================

export interface IChatMessageRepository extends IBaseRepository<ChatMessage> {
  findByConversationId(conversationId: string): ChatMessage[]
  findByConversationIdAndRole(conversationId: string, role: string): ChatMessage[]
}

// ============================================================================
// 方法论 Repository
// ============================================================================

export interface IMethodologyRepository extends IBaseRepository<Methodology> {
  findByBookId(bookId: string): Methodology[]
  findByTag(tag: string): Methodology[]
  updateMastery(id: string, masteryLevel: number, practiceCount: number): void
}

// ============================================================================
// 知识卡片 Repository
// ============================================================================

export interface IKnowledgeCardRepository extends IBaseRepository<KnowledgeCard> {
  findByBookId(bookId: string): KnowledgeCard[]
  findByType(type: string): KnowledgeCard[]
  findByTag(tag: string): KnowledgeCard[]
  updateMastery(id: string, masteryLevel: number): void
  updateReviewCount(id: string, reviewCount: number): void
}

// ============================================================================
// 记忆 Repository
// ============================================================================

export interface IMemoryRepository extends IBaseRepository<Memory> {
  findByType(type: string): Memory[]
  findByCategory(category: string): Memory[]
  findImportant(limit?: number): Memory[]
  updateAccessCount(id: string, accessCount: number): void
  updateLastAccessedAt(id: string): void
}

// ============================================================================
// 词汇 Repository
// ============================================================================

export interface IVocabularyRepository extends IBaseRepository<Vocabulary> {
  findByWord(word: string): Vocabulary | null
  findMastered(): Vocabulary[]
  findForReview(limit?: number): Vocabulary[]
  findByStage(stage: number): Vocabulary[]
  updateMastered(id: string, isMastered: boolean): void
  updateReviewInfo(id: string, info: Partial<Vocabulary>): void
  updateLearningStage(id: string, stage: number): void
}

// ============================================================================
// 文章 Repository
// ============================================================================

export interface IArticleRepository extends IBaseRepository<Article> {
  findBySource(source: string): Article[]
  findByDifficulty(difficulty: string): Article[]
  findByCategory(category: string): Article[]
  findUnread(): Article[]
  findFavorites(): Article[]
  markAsRead(id: string): void
  toggleFavorite(id: string): void
}

// ============================================================================
// 书籍架构 Repository
// ============================================================================

export interface IBookArchitectureRepository extends IBaseRepository<BookArchitecture> {
  findByBookId(bookId: string): BookArchitecture | null
  upsertByBookId(bookId: string, data: Partial<BookArchitecture>): void
}

// ============================================================================
// 书籍摘要 Repository
// ============================================================================

export interface IBookSummaryRepository extends IBaseRepository<BookSummary> {
  findByBookId(bookId: string): BookSummary | null
  upsertByBookId(bookId: string, data: Partial<BookSummary>): void
}

// ============================================================================
// 每日统计 Repository
// ============================================================================

export interface IDailyStatsRepository extends IBaseRepository<DailyStats> {
  findByDate(date: string): DailyStats | null
  findByDateRange(startDate: string, endDate: string): DailyStats[]
  upsertByDate(date: string, data: Partial<DailyStats>): void
}

// ============================================================================
// Token 使用记录 Repository
// ============================================================================

export interface ITokenUsageRepository extends IBaseRepository<TokenUsage> {
  findByFeature(feature: string): TokenUsage[]
  findByProvider(provider: string): TokenUsage[]
  findByDateRange(startDate: string, endDate: string): TokenUsage[]
  getTotalTokens(): number
  getTotalCost(): number
}

// ============================================================================
// Repository 容器接口
// ============================================================================

/**
 * Repository 容器，用于依赖注入
 */
export interface IRepositoryContainer {
  books: IBookRepository
  highlights: IHighlightRepository
  cards: ICardRepository
  conversations: IConversationRepository
  chatMessages: IChatMessageRepository
  methodologies: IMethodologyRepository
  knowledgeCards: IKnowledgeCardRepository
  memories: IMemoryRepository
  vocabulary: IVocabularyRepository
  articles: IArticleRepository
  bookArchitecture: IBookArchitectureRepository
  bookSummaries: IBookSummaryRepository
  dailyStats: IDailyStatsRepository
  tokenUsage: ITokenUsageRepository
}
