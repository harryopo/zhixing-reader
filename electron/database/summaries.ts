/**
 * database/summaries — 书籍摘要表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export const bookSummariesDb = {
  getByBookId(bookId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM book_summaries WHERE book_id = ?',
      [bookId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  create(bookId: string, summary: string, keyPoints?: string): void {
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      'INSERT OR REPLACE INTO book_summaries (id, book_id, summary, key_points) VALUES (?, ?, ?, ?)',
      [id, bookId, summary, keyPoints ?? null]
    );
    saveDatabase();
  },

  delete(bookId: string): void {
    getDatabase().run('DELETE FROM book_summaries WHERE book_id = ?', [bookId]);
    saveDatabase();
  },
};
