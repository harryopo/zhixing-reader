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
} from './entities'
import { ReviewStats } from '../../src/shared/types'

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
  getReviewStats(): ReviewStats
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
}
