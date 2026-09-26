/**
 * database/summaries — 书籍摘要表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

/** 读出来就是驼峰 —— 这条链路终于有前端消费者了，别再让渲染层猜列名 */
export interface BookSummaryRow {
  id: string
  bookId: string
  summary: string
  /** AI 要点数组的 JSON 字符串，没有就是 null */
  keyPoints: string | null
  generatedAt: string
}

export const bookSummariesDb = {
  getByBookId(bookId: string): BookSummaryRow | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM book_summaries WHERE book_id = ?',
      [bookId]
    );
    const row = rowsToObjects(result)[0];
    if (!row) return undefined;
    return {
      id: String(row.id ?? ''),
      bookId: String(row.book_id ?? ''),
      summary: String(row.summary ?? ''),
      keyPoints: row.key_points == null ? null : String(row.key_points),
      generatedAt: String(row.generated_at ?? ''),
    };
  },

  create(bookId: string, summary: string, keyPoints?: string): void {
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      'INSERT OR REPLACE INTO book_summaries (id, book_id, summary, key_points) VALUES (?, ?, ?, ?)',
      [id, bookId, summary, keyPoints ?? null]
    );
    saveDatabase();
  },
};
