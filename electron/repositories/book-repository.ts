/**
 * 书籍 Repository 实现
 * 封装书籍表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Book } from '../types/entities'
import { IBookRepository } from '../types/repositories'

export class SqlBookRepository extends BaseRepository<Book> implements IBookRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'books'
  }

  protected mapToEntity(row: Record<string, unknown>): Book {
    return {
      id: row.id as string,
      title: row.title as string,
      author: row.author as string | undefined,
      cover: row.cover as string | undefined,
      isbn: row.isbn as string | undefined,
      publisher: row.publisher as string | undefined,
      publishDate: row.publish_date as string | undefined,
      description: row.description as string | undefined,
      category: row.category as string | undefined,
      readingProgress: (row.reading_progress as number) ?? 0,
      totalChapter: (row.total_chapter as number) ?? 0,
      lastReadTime: row.last_read_time as string | undefined,
      isFinished: Boolean(row.is_finished),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  protected mapToRow(entity: Partial<Book>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.title !== undefined) row.title = entity.title
    if (entity.author !== undefined) row.author = entity.author
    if (entity.cover !== undefined) row.cover = entity.cover
    if (entity.isbn !== undefined) row.isbn = entity.isbn
    if (entity.publisher !== undefined) row.publisher = entity.publisher
    if (entity.publishDate !== undefined) row.publish_date = entity.publishDate
    if (entity.description !== undefined) row.description = entity.description
    if (entity.category !== undefined) row.category = entity.category
    if (entity.readingProgress !== undefined) row.reading_progress = entity.readingProgress
    if (entity.totalChapter !== undefined) row.total_chapter = entity.totalChapter
    if (entity.lastReadTime !== undefined) row.last_read_time = entity.lastReadTime
    if (entity.isFinished !== undefined) row.is_finished = entity.isFinished ? 1 : 0
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt
    if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt

    return row
  }

  /**
   * 根据状态查找书籍
   */
  findByStatus(status: string): Book[] {
    const rows = this.query(
      'SELECT * FROM books WHERE status = ? ORDER BY updated_at DESC',
      [status]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找最近阅读的书籍
   */
  findRecent(limit: number = 10): Book[] {
    const rows = this.query(
      'SELECT * FROM books ORDER BY last_read_time DESC NULLS LAST, updated_at DESC LIMIT ?',
      [limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 搜索书籍
   */
  search(keyword: string): Book[] {
    const pattern = `%${keyword}%`
    const rows = this.query(
      'SELECT * FROM books WHERE title LIKE ? OR author LIKE ?',
      [pattern, pattern]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 更新阅读进度
   */
  updateProgress(id: string, progress: number): void {
    this.execute(
      "UPDATE books SET reading_progress = ?, updated_at = datetime('now') WHERE id = ?",
      [progress, id]
    )
  }

  /**
   * 批量创建书籍
   */
  createBatch(books: Array<Partial<Book>>): void {
    this.transaction((db) => {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category, reading_progress, total_chapter, last_read_time, is_finished)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const book of books) {
        stmt.run([
          book.id,
          book.title,
          book.author ?? null,
          book.cover ?? null,
          book.isbn ?? null,
          book.publisher ?? null,
          book.publishDate ?? null,
          book.description ?? null,
          book.category ?? null,
          book.readingProgress ?? 0,
          book.totalChapter ?? 0,
          book.lastReadTime ?? null,
          book.isFinished ? 1 : 0,
        ])
      }

      stmt.free()
    })
  }
}
