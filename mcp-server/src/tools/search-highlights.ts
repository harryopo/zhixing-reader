import { z } from 'zod';
import { query, type SqlValue } from '../db.js';
import type { HighlightSearchItem } from '../types.js';

/**
 * zhixing_search_highlights Tool 实现。
 *
 * 搜索划线和笔记内容，支持按关键词匹配划线内容或笔记。
 * 可选限定某本书的范围内搜索。
 */

export const SearchHighlightsInputSchema = z.object({
  keyword: z
    .string()
    .min(1, '搜索关键词不能为空')
    .max(500, '搜索关键词不能超过 500 字符')
    .describe('搜索关键词，匹配划线内容或笔记'),
  bookId: z
    .string()
    .optional()
    .describe('可选：限定某本书 ID 范围内搜索'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('返回结果上限，1-100，默认 20'),
}).strict();

export type SearchHighlightsInput = z.infer<typeof SearchHighlightsInputSchema>;

/**
 * 执行划线搜索。
 * 同时匹配 content 和 note 字段，使用 LIKE 模糊查询。
 * SQL 参数化查询，防止注入。
 */
export async function searchHighlights(params: SearchHighlightsInput): Promise<HighlightSearchItem[]> {
  const pattern = `%${params.keyword}%`;

  let sql = `
    SELECT
      h.id,
      h.book_id,
      b.title AS book_title,
      h.content,
      h.chapter_title,
      h.note,
      h.style,
      h.created_at
    FROM highlights h
    JOIN books b ON h.book_id = b.id
    WHERE (h.content LIKE ? OR h.note LIKE ?)
  `;
  const sqlParams: SqlValue[] = [pattern, pattern];

  if (params.bookId) {
    sql += ` AND h.book_id = ?`;
    sqlParams.push(params.bookId);
  }

  sql += ` ORDER BY h.created_at DESC LIMIT ?`;
  sqlParams.push(params.limit);

  const rows = query(sql, sqlParams);

  return rows.map((row): HighlightSearchItem => ({
    id: String(row.id),
    bookId: String(row.book_id),
    bookTitle: String(row.book_title),
    content: String(row.content),
    chapterTitle: row.chapter_title == null ? null : String(row.chapter_title),
    note: row.note == null ? null : String(row.note),
    style: Number(row.style ?? 0),
    createdAt: String(row.created_at),
  }));
}
