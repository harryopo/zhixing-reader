/**
 * 对话 Repository 实现
 * 封装对话表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Conversation, ChatMessage } from '../types/entities'
import { IConversationRepository, IChatMessageRepository } from '../types/repositories'

/**
 * 对话 Repository 实现
 */
export class SqlConversationRepository extends BaseRepository<Conversation> implements IConversationRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'conversations'
  }

  protected mapToEntity(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      title: (row.title as string) ?? '',
      bookId: row.book_id as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      messageCount: (row.message_count as number) ?? 0,
    }
  }

  protected mapToRow(entity: Partial<Conversation>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.title !== undefined) row.title = entity.title
    if (entity.bookId !== undefined) row.book_id = entity.bookId
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt
    if (entity.messageCount !== undefined) row.message_count = entity.messageCount

    return row
  }

  /**
   * 根据书籍 ID 查找对话
   */
  findByBookId(bookId: string): Conversation[] {
    const rows = this.query(
      'SELECT * FROM conversations WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找最近的对话
   */
  findRecent(limit: number = 10): Conversation[] {
    const rows = this.query(
      'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?',
      [limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 更新消息数量
   */
  updateMessageCount(id: string, count: number): void {
    this.execute(
      "UPDATE conversations SET message_count = ?, updated_at = datetime('now') WHERE id = ?",
      [count, id]
    )
  }
}

/**
 * 聊天消息 Repository 实现
 */
export class SqlChatMessageRepository extends BaseRepository<ChatMessage> implements IChatMessageRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'chat_messages'
  }

  protected mapToEntity(row: Record<string, unknown>): ChatMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content as string,
      intent: row.intent as string | undefined,
      toolsUsed: row.tools_used as string | undefined,
      bloomLevel: row.bloom_level as number | undefined,
      masteryAssessment: row.mastery_assessment as string | undefined,
      sources: row.sources as string | undefined,
      createdAt: row.created_at as string,
    }
  }

  protected mapToRow(entity: Partial<ChatMessage>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.conversationId !== undefined) row.conversation_id = entity.conversationId
    if (entity.role !== undefined) row.role = entity.role
    if (entity.content !== undefined) row.content = entity.content
    if (entity.intent !== undefined) row.intent = entity.intent
    if (entity.toolsUsed !== undefined) row.tools_used = entity.toolsUsed
    if (entity.bloomLevel !== undefined) row.bloom_level = entity.bloomLevel
    if (entity.masteryAssessment !== undefined) row.mastery_assessment = entity.masteryAssessment
    if (entity.sources !== undefined) row.sources = entity.sources
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt

    return row
  }

  /**
   * 根据对话 ID 查找消息
   */
  findByConversationId(conversationId: string): ChatMessage[] {
    const rows = this.query(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据对话 ID 和角色查找消息
   */
  findByConversationIdAndRole(conversationId: string, role: string): ChatMessage[] {
    const rows = this.query(
      'SELECT * FROM chat_messages WHERE conversation_id = ? AND role = ? ORDER BY created_at ASC',
      [conversationId, role]
    )
    return rows.map(row => this.mapToEntity(row))
  }
}
