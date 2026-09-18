/**
 * database/chapter-summaries —— 层级摘要 L1（章节摘要）表操作
 *
 * 写入只在「生成章节摘要」这一个批处理里发生，所以对外提供 upsertBatch：
 * 单章一条 saveDatabase() 意味着整本书生成一次就把整个库导盘几十次
 * （sql.js 的持久化是全文导出，不是增量写）。
 */
import { getDatabase, runTransaction, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export interface ChapterSummaryRow {
  id: string
  bookId: string
  chapterTitle: string
  summary: string
  sourceCount: number
  generatedAt: string
}

export interface ChapterSummaryInput {
  chapterTitle: string
  summary: string
  sourceCount: number
}

function mapRows(rows: Record<string, unknown>[]): ChapterSummaryRow[] {
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    bookId: String(row.book_id ?? ''),
    chapterTitle: String(row.chapter_title ?? ''),
    summary: String(row.summary ?? ''),
    sourceCount: Number(row.source_count ?? 0),
    generatedAt: String(row.generated_at ?? ''),
  }));
}

export const chapterSummariesDb = {
  getByBookId(bookId: string): ChapterSummaryRow[] {
    const result = getDatabase().exec(
      'SELECT * FROM chapter_summaries WHERE book_id = ? ORDER BY chapter_title',
      [bookId]
    );
    return mapRows(rowsToObjects(result));
  },

  /** 已有哪些章节摘要、各自基于多少条划线 —— 新鲜度判定的输入 */
  getSourceCounts(bookId: string): Array<{ chapterTitle: string; sourceCount: number }> {
    return chapterSummariesDb.getByBookId(bookId).map((r) => ({
      chapterTitle: r.chapterTitle,
      sourceCount: r.sourceCount,
    }));
  },

  upsertBatch(bookId: string, items: ChapterSummaryInput[]): number {
    if (items.length === 0) return 0;
    const stamp = Date.now();
    runTransaction((database) => {
      items.forEach((item, i) => {
        database.run(
          `INSERT INTO chapter_summaries (id, book_id, chapter_title, summary, source_count, generated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT (book_id, chapter_title) DO UPDATE SET
             summary = excluded.summary,
             source_count = excluded.source_count,
             generated_at = excluded.generated_at`,
          [`chapter_${stamp}_${i}_${Math.random().toString(36).slice(2, 9)}`, bookId, item.chapterTitle, item.summary, item.sourceCount]
        );
      });
    });
    return items.length;
  },

  deleteByBookId(bookId: string): void {
    getDatabase().run('DELETE FROM chapter_summaries WHERE book_id = ?', [bookId]);
    saveDatabase();
  },
};
