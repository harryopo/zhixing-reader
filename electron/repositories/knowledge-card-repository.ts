/**
 * 知识卡片 Repository 实现
 * 封装知识卡片表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { KnowledgeCard } from '../types/entities'
import { IKnowledgeCardRepository } from '../types/repositories'

export class SqlKnowledgeCardRepository extends BaseRepository<KnowledgeCard> implements IKnowledgeCardRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'knowledge_cards'
  }

  protected mapToEntity(row: Record<string, unknown>): KnowledgeCard {
    return {
      id: row.id as string,
      bookId: row.book_id as string,
      type: row.type as 'concept' | 'methodology' | 'quote',
      title: row.title as string,
      content: row.content as string,
      interpretation: row.interpretation as string | undefined,
      application: row.application as string | undefined,
      relatedCardIds: row.related_card_ids as string | undefined,
      tags: row.tags as string | undefined,
      sourceHighlightId: row.source_highlight_id as string | undefined,
      reviewCount: (row.review_count as number) ?? 0,
      masteryLevel: (row.mastery_level as number) ?? 0,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  protected mapToRow(entity: Partial<KnowledgeCard>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.bookId !== undefined) row.book_id = entity.bookId
    if (entity.type !== undefined) row.type = entity.type
    if (entity.title !== undefined) row.title = entity.title
    if (entity.content !== undefined) row.content = entity.content
    if (entity.interpretation !== undefined) row.interpretation = entity.interpretation
    if (entity.application !== undefined) row.application = entity.application
    if (entity.relatedCardIds !== undefined) row.related_card_ids = entity.relatedCardIds
    if (entity.tags !== undefined) row.tags = entity.tags
    if (entity.sourceHighlightId !== undefined) row.source_highlight_id = entity.sourceHighlightId
    if (entity.reviewCount !== undefined) row.review_count = entity.reviewCount
    if (entity.masteryLevel !== undefined) row.mastery_level = entity.masteryLevel
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt

    return row
  }

  /**
   * 根据书籍 ID 查找知识卡片
   */
  findByBookId(bookId: string): KnowledgeCard[] {
    const rows = this.query(
      'SELECT * FROM knowledge_cards WHERE book_id = ? ORDER BY created_at DESC',
      [bookId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据类型查找知识卡片
   */
  findByType(type: string): KnowledgeCard[] {
    const rows = this.query(
      'SELECT * FROM knowledge_cards WHERE type = ? ORDER BY created_at DESC',
      [type]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据标签查找知识卡片
   */
  findByTag(tag: string): KnowledgeCard[] {
    const rows = this.query(
      "SELECT * FROM knowledge_cards WHERE tags LIKE ? ORDER BY created_at DESC",
      [`%${tag}%`]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 更新掌握度
   */
  updateMastery(id: string, masteryLevel: number): void {
    this.execute(
      "UPDATE knowledge_cards SET mastery_level = ?, updated_at = datetime('now') WHERE id = ?",
      [masteryLevel, id]
    )
  }

  /**
   * 更新复习次数
   */
  updateReviewCount(id: string, reviewCount: number): void {
    this.execute(
      "UPDATE knowledge_cards SET review_count = ?, updated_at = datetime('now') WHERE id = ?",
      [reviewCount, id]
    )
  }
}
