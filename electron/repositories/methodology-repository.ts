/**
 * 方法论 Repository 实现
 * 封装方法论表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Methodology } from '../types/entities'
import { IMethodologyRepository } from '../types/repositories'

export class SqlMethodologyRepository extends BaseRepository<Methodology> implements IMethodologyRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'methodologies'
  }

  protected mapToEntity(row: Record<string, unknown>): Methodology {
    return {
      id: row.id as string,
      bookId: row.book_id as string,
      name: row.name as string,
      nameEn: row.name_en as string | undefined,
      triggerScenario: row.trigger_scenario as string | undefined,
      description: row.description as string | undefined,
      steps: row.steps as string | undefined,
      outputFormat: row.output_format as string | undefined,
      examples: row.examples as string | undefined,
      tags: row.tags as string | undefined,
      sourceHighlightIds: row.source_highlight_ids as string | undefined,
      masteryLevel: (row.mastery_level as number) ?? 0,
      practiceCount: (row.practice_count as number) ?? 0,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  protected mapToRow(entity: Partial<Methodology>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.bookId !== undefined) row.book_id = entity.bookId
    if (entity.name !== undefined) row.name = entity.name
    if (entity.nameEn !== undefined) row.name_en = entity.nameEn
    if (entity.triggerScenario !== undefined) row.trigger_scenario = entity.triggerScenario
    if (entity.description !== undefined) row.description = entity.description
    if (entity.steps !== undefined) row.steps = entity.steps
    if (entity.outputFormat !== undefined) row.output_format = entity.outputFormat
    if (entity.examples !== undefined) row.examples = entity.examples
    if (entity.tags !== undefined) row.tags = entity.tags
    if (entity.sourceHighlightIds !== undefined) row.source_highlight_ids = entity.sourceHighlightIds
    if (entity.masteryLevel !== undefined) row.mastery_level = entity.masteryLevel
    if (entity.practiceCount !== undefined) row.practice_count = entity.practiceCount
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt

    return row
  }

  /**
   * 根据书籍 ID 查找方法论
   */
  findByBookId(bookId: string): Methodology[] {
    const rows = this.query(
      'SELECT * FROM methodologies WHERE book_id = ? ORDER BY created_at DESC',
      [bookId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据标签查找方法论
   */
  findByTag(tag: string): Methodology[] {
    const rows = this.query(
      "SELECT * FROM methodologies WHERE tags LIKE ? ORDER BY created_at DESC",
      [`%${tag}%`]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 更新掌握度
   */
  updateMastery(id: string, masteryLevel: number, practiceCount: number): void {
    this.execute(
      "UPDATE methodologies SET mastery_level = ?, practice_count = ?, updated_at = datetime('now') WHERE id = ?",
      [masteryLevel, practiceCount, id]
    )
  }
}
