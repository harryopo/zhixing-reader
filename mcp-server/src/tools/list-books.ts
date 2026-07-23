import { z } from 'zod';
import { query } from '../db.js';
import type { BookListItem } from '../types.js';

/**
 * zhixing_list_books Tool 实现。
 *
 * 列出书架上的书籍，按最近阅读时间倒序排列。
 * 同时统计每本书的划线总数。
 */

export const ListBooksInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('返回书籍数量上限，1-200，默认 50'),
}).strict();

export type ListBooksInput = z.infer<typeof ListBooksInputSchema>;

/**
 * 执行书架查询。
 * 使用 LEFT JOIN highlights 统计每本书的划线数，
 * 即使无划线的书也会返回（totalHighlights = 0）。
 */
export async function listBooks(params: ListBooksInput): Promise<BookListItem[]> {
  const sql = `
    SELECT
      b.id AS book_id,
      b.title,
      b.author,
      b.cover,
      b.reading_progress,
      b.total_chapter,
      b.is_finished,
      b.source,
      b.last_read_time,
      b.created_at,
      b.updated_at,
      COUNT(h.id) AS total_highlights
    FROM books b
    LEFT JOIN highlights h ON h.book_id = b.id
    GROUP BY b.id
    ORDER BY b.last_read_time DESC NULLS LAST, b.updated_at DESC
    LIMIT ?
  `;

  const rows = query(sql, [params.limit]);

  return rows.map((row): BookListItem => ({
    bookId: String(row.book_id),
    title: String(row.title),
    author: row.author == null ? null : String(row.author),
    cover: row.cover == null ? null : String(row.cover),
    readingProgress: Number(row.reading_progress ?? 0),
    totalChapter: Number(row.total_chapter ?? 0),
    isFinished: Boolean(row.is_finished),
    source: String(row.source ?? 'weread'),
    lastReadAt: row.last_read_time == null ? null : String(row.last_read_time),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    totalHighlights: Number(row.total_highlights ?? 0),
  }));
}
