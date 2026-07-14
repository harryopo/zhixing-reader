/**
 * 记忆 Repository 实现
 * 封装记忆表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Memory } from '../types/entities'
import { IMemoryRepository } from '../types/repositories'

export class SqlMemoryRepository extends BaseRepository<Memory> implements IMemoryRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'memories'
  }

  protected mapToEntity(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      type: row.type as 'preference' | 'insight' | 'interaction' | 'achievement',
      category: row.category as string,
      content: row.content as string,
      importance: (row.importance as number) ?? 0.5,
      context: row.context as string | undefined,
      accessCount: (row.access_count as number) ?? 0,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
    }
  }

  protected mapToRow(entity: Partial<Memory>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.type !== undefined) row.type = entity.type
    if (entity.category !== undefined) row.category = entity.category
    if (entity.content !== undefined) row.content = entity.content
    if (entity.importance !== undefined) row.importance = entity.importance
    if (entity.context !== undefined) row.context = entity.context
    if (entity.accessCount !== undefined) row.access_count = entity.accessCount
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.lastAccessedAt !== undefined) row.last_accessed_at = entity.lastAccessedAt

    return row
  }

  /**
   * 根据类型查找记忆
   */
  findByType(type: string): Memory[] {
    const rows = this.query(
      'SELECT * FROM memories WHERE type = ? ORDER BY importance DESC, created_at DESC',
      [type]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据分类查找记忆
   */
  findByCategory(category: string): Memory[] {
    const rows = this.query(
      'SELECT * FROM memories WHERE category = ? ORDER BY importance DESC, created_at DESC',
      [category]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找重要的记忆
   */
  findImportant(limit: number = 10): Memory[] {
    const rows = this.query(
      'SELECT * FROM memories ORDER BY importance DESC, access_count DESC LIMIT ?',
      [limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 更新访问次数
   */
  updateAccessCount(id: string, accessCount: number): void {
    this.execute(
      'UPDATE memories SET access_count = ? WHERE id = ?',
      [accessCount, id]
    )
  }

  /**
   * 更新最后访问时间
   */
  updateLastAccessedAt(id: string): void {
    this.execute(
      "UPDATE memories SET last_accessed_at = datetime('now') WHERE id = ?",
      [id]
    )
  }
}
