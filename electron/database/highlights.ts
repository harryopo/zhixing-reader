/**
 * database/highlights — 划线表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 * 依赖 cards：批量导入划线时自动创建 FSRS 复习卡片（原行为保留）。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';
import { cardsDb } from './cards';

export const highlightsDb = {
  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT h.*, b.title as book_title FROM highlights h JOIN books b ON h.book_id = b.id WHERE h.book_id = ? ORDER BY h.created_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM highlights WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  exists(bookId: string, content: string): boolean {
    const result = getDatabase().exec(
      'SELECT 1 FROM highlights WHERE book_id = ? AND content = ? LIMIT 1',
      [bookId, content]
    );
    return result.length > 0 && result[0].values.length > 0;
  },

  create(highlight: Record<string, unknown>): boolean {
    const bookId = highlight.book_id as string;
    const content = highlight.content as string;

    if (this.exists(bookId, content)) {
      return false;
    }

    getDatabase().run(
      `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        highlight.id,
        bookId,
        highlight.chapter_title ?? null,
        content,
        highlight.note ?? null,
        highlight.style ?? 0,
        highlight.range_start ?? null,
        highlight.range_end ?? null,
      ]
    );
    saveDatabase();
    return true;
  },

  createBatch(highlights: Array<Record<string, unknown>>): number {
    let newCount = 0;
    const newHighlightIds: string[] = [];
    runTransaction((database) => {
      const bookIds = [...new Set(highlights.map(h => h.book_id as string))];
      const placeholders = bookIds.map(() => '?').join(', ');
      const existingRows = database.exec(
        `SELECT book_id, content FROM highlights WHERE book_id IN (${placeholders})`,
        bookIds
      );
      const existingSet = new Set<string>();
      if (existingRows.length > 0 && existingRows[0].values.length > 0) {
        for (const row of existingRows[0].values) {
          existingSet.add(`${row[0]}:${row[1]}`);
        }
      }

      const stmt = database.prepare(
        `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const highlight of highlights) {
        const bookId = highlight.book_id as string;
        const content = highlight.content as string;

        if (existingSet.has(`${bookId}:${content}`)) {
          continue;
        }

        stmt.run([
          highlight.id,
          bookId,
          highlight.chapter_title ?? null,
          content,
          highlight.note ?? null,
          highlight.style ?? 0,
          highlight.range_start ?? null,
          highlight.range_end ?? null,
        ]);
        existingSet.add(`${bookId}:${content}`);
        newHighlightIds.push(highlight.id as string);
        newCount++;
      }

      stmt.free();
    });

    // 批量创建复习卡片
    if (newHighlightIds.length > 0) {
      try {
        cardsDb.createBatch(newHighlightIds);
      } catch (error) {
        logger.error('批量创建复习卡片失败', { error: String(error), count: newHighlightIds.length });
      }
    }

    return newCount;
  },

  update(id: string, highlight: Record<string, unknown>): void {
    const updatableKeys = Object.keys(highlight).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => highlight[k]);
    getDatabase().run(
      `UPDATE highlights SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM highlights WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM highlights WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByBookId(bookId: string): void {
    getDatabase().run('DELETE FROM highlights WHERE book_id = ?', [bookId]);
    saveDatabase();
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
    `);
    return rowsToObjects(result);
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      WHERE h.content LIKE ? OR h.note LIKE ?
      ORDER BY h.created_at DESC
    `, [pattern, pattern]);
    return rowsToObjects(result);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM highlights');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  countByBookId(bookId: string): number {
    const result = getDatabase().exec(
      'SELECT COUNT(*) FROM highlights WHERE book_id = ?',
      [bookId]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  getRecent(limit: number = 20): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
      LIMIT ?
    `, [limit]);
    return rowsToObjects(result);
  },
};
