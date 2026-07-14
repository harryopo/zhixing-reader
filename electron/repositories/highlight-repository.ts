/**
 * 高亮 Repository 实现
 * 封装高亮表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Highlight } from '../types/entities'
import { IHighlightRepository } from '../types/repositories'

export class SqlHighlightRepository extends BaseRepository<Highlight> implements IHighlightRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'highlights'
  }

  protected mapToEntity(row: Record<string, unknown>): Highlight {
    return {
      id: row.id as string,
      bookId: row.book_id as string,
      chapterTitle: row.chapter_title as string | undefined,
      content: row.content as string,
      note: row.note as string | undefined,
      style: (row.style as number) ?? 0,
      rangeStart: row.range_start as string | undefined,
      rangeEnd: row.range_end as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      bookTitle: row.book_title as string | undefined,
    }
  }

  protected mapToRow(entity: Partial<Highlight>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.bookId !== undefined) row.book_id = entity.bookId
    if (entity.chapterTitle !== undefined) row.chapter_title = entity.chapterTitle
    if (entity.content !== undefined) row.content = entity.content
    if (entity.note !== undefined) row.note = entity.note
    if (entity.style !== undefined) row.style = entity.style
    if (entity.rangeStart !== undefined) row.range_start = entity.rangeStart
    if (entity.rangeEnd !== undefined) row.range_end = entity.rangeEnd
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt

    return row
  }

  /**
   * 根据书籍 ID 查找高亮
   */
  findByBookId(bookId: string): Highlight[] {
    const rows = this.query(
      `SELECT h.*, b.title as book_title 
       FROM highlights h 
       JOIN books b ON h.book_id = b.id 
       WHERE h.book_id = ? 
       ORDER BY h.created_at DESC`,
      [bookId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找最近的高亮
   */
  findRecent(limit: number = 20): Highlight[] {
    const rows = this.query(
      `SELECT h.*, b.title as book_title 
       FROM highlights h 
       JOIN books b ON h.book_id = b.id 
       ORDER BY h.created_at DESC 
       LIMIT ?`,
      [limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 搜索高亮
   */
  search(keyword: string): Highlight[] {
    const pattern = `%${keyword}%`
    const rows = this.query(
      `SELECT h.*, b.title as book_title 
       FROM highlights h 
       JOIN books b ON h.book_id = b.id 
       WHERE h.content LIKE ? OR h.note LIKE ? 
       ORDER BY h.created_at DESC`,
      [pattern, pattern]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 检查高亮是否已存在
   */
  existsByContent(bookId: string, content: string): boolean {
    const row = this.queryOne(
      'SELECT 1 FROM highlights WHERE book_id = ? AND content = ? LIMIT 1',
      [bookId, content]
    )
    return row !== null
  }

  /**
   * 批量创建高亮
   * @returns 新创建的高亮数量
   */
  createBatch(highlights: Array<Partial<Highlight>>): number {
    let newCount = 0

    this.transaction((db) => {
      // 获取已存在的高亮
      const bookIds = [...new Set(highlights.map(h => h.bookId).filter(Boolean))]
      if (bookIds.length === 0) return

      const placeholders = bookIds.map(() => '?').join(', ')
      const existingRows = db.exec(
        `SELECT book_id, content FROM highlights WHERE book_id IN (${placeholders})`,
        bookIds
      )

      const existingSet = new Set<string>()
      if (existingRows.length > 0 && existingRows[0].values.length > 0) {
        for (const row of existingRows[0].values) {
          existingSet.add(`${row[0]}:${row[1]}`)
        }
      }

      // 插入新的高亮
      const stmt = db.prepare(
        `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const highlight of highlights) {
        const bookId = highlight.bookId
        const content = highlight.content

        if (!bookId || !content) continue
        if (existingSet.has(`${bookId}:${content}`)) continue

        stmt.run([
          highlight.id ?? this.generateId(),
          bookId,
          highlight.chapterTitle ?? null,
          content,
          highlight.note ?? null,
          highlight.style ?? 0,
          highlight.rangeStart ?? null,
          highlight.rangeEnd ?? null,
        ])

        existingSet.add(`${bookId}:${content}`)
        newCount++
      }

      stmt.free()
    })

    return newCount
  }

  /**
   * 根据书籍 ID 删除高亮
   */
  deleteByBookId(bookId: string): void {
    this.execute('DELETE FROM highlights WHERE book_id = ?', [bookId])
  }

  /**
   * 统计书籍的高亮数量
   */
  countByBookId(bookId: string): number {
    return this.queryScalar(
      'SELECT COUNT(*) FROM highlights WHERE book_id = ?',
      [bookId]
    )
  }

  /**
   * 查找所有高亮（包含书籍标题）
   */
  findAll(): Highlight[] {
    const rows = this.query(
      `SELECT h.*, b.title as book_title 
       FROM highlights h 
       JOIN books b ON h.book_id = b.id 
       ORDER BY h.created_at DESC`
    )
    return rows.map(row => this.mapToEntity(row))
  }
}
