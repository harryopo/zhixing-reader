/**
 * database/methodologies — 方法论表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';

export const methodologiesDb = {
  create(methodology: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO methodologies (id, book_id, name, name_en, trigger_scenario, description, steps, output_format, examples, tags, source_highlight_ids, mastery_level, practice_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        methodology.id,
        methodology.book_id ?? methodology.bookId,
        methodology.name,
        methodology.name_en ?? methodology.nameEn ?? null,
        methodology.trigger_scenario ?? methodology.triggerScenario ?? null,
        methodology.description ?? null,
        methodology.steps ? JSON.stringify(methodology.steps) : null,
        methodology.output_format ?? methodology.outputFormat ?? null,
        methodology.examples ?? null,
        methodology.tags ? JSON.stringify(methodology.tags) : null,
        methodology.source_highlight_ids ?? methodology.sourceHighlightIds ? JSON.stringify(methodology.source_highlight_ids ?? methodology.sourceHighlightIds) : null,
        methodology.mastery_level ?? methodology.masteryLevel ?? 0,
        methodology.practice_count ?? methodology.practiceCount ?? 0,
      ]
    );
    saveDatabase();
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM methodologies WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM methodologies WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  /** 每本书有多少条方法论（判"成品是否还在"用；成品清空后台账进度就该作废） */
  getCountsByBook(): Record<string, number> {
    const result = getDatabase().exec('SELECT book_id, COUNT(*) FROM methodologies GROUP BY book_id');
    const counts: Record<string, number> = {};
    if (result.length > 0) {
      for (const [bookId, count] of result[0].values) counts[String(bookId)] = Number(count);
    }
    return counts;
  },

  /**
   * 删除某本书的全部方法论，返回删除条数（单事务，符合 B12）。
   * 用途同 knowledge-cards.deleteByBookId：让"重新提取"真的是替换而不是追加。
   */
  deleteByBookId(bookId: string): number {
    const before = getDatabase().exec('SELECT COUNT(*) FROM methodologies WHERE book_id = ?', [bookId]);
    const count = before.length > 0 ? Number(before[0].values[0][0]) || 0 : 0;
    if (count === 0) return 0;
    runTransaction((database) => {
      database.run('DELETE FROM methodologies WHERE book_id = ?', [bookId]);
    });
    return count;
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT m.*, b.title as book_title FROM methodologies m
       JOIN books b ON m.book_id = b.id
       ORDER BY m.updated_at DESC`
    );
    return rowsToObjects(result);
  },

  update(id: string, methodology: Record<string, unknown>): void {
    const updatableKeys = Object.keys(methodology).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = methodology[k];
      if (Array.isArray(val)) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE methodologies SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM methodologies WHERE id = ?', [id]);
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT m.*, b.title as book_title FROM methodologies m
       JOIN books b ON m.book_id = b.id
       WHERE m.name LIKE ? OR m.description LIKE ? OR m.tags LIKE ?`,
      [pattern, pattern, pattern]
    );
    return rowsToObjects(result);
  },
};
