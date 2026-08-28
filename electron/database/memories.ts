/**
 * database/memories — AI 对话长期记忆表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, forceSaveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export const memoriesDb = {
  create(memory: {
    type: string;
    category: string;
    content: string;
    importance?: number;
    context?: string;
  }): void {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO memories (id, type, category, content, importance, context)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.type,
        memory.category,
        memory.content,
        memory.importance ?? 0.5,
        memory.context ?? null,
      ]
    );
    saveDatabase();
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM memories ORDER BY importance DESC, created_at DESC'
    );
    return rowsToObjects(result);
  },

  getRelevant(queryTerms: string[], limit: number = 10): Record<string, unknown>[] {
    if (queryTerms.length === 0) return [];
    const conditions = queryTerms.map(() => '(content LIKE ? OR category LIKE ?)').join(' OR ');
    const params: string[] = [];
    for (const term of queryTerms) {
      params.push(`%${term}%`, `%${term}%`);
    }
    params.push(String(limit));
    const result = getDatabase().exec(
      `SELECT * FROM memories WHERE ${conditions} ORDER BY importance DESC LIMIT ?`,
      params
    );
    return rowsToObjects(result);
  },

  incrementAccess(id: string): void {
    getDatabase().run(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?`,
      [id]
    );
    saveDatabase();
  },

  getStats(): { total: number; byType: Record<string, number> } {
    const totalResult = getDatabase().exec('SELECT COUNT(*) FROM memories');
    const total = totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0;

    const typeResult = getDatabase().exec('SELECT type, COUNT(*) as cnt FROM memories GROUP BY type');
    const byType: Record<string, number> = {};
    if (typeResult.length > 0) {
      for (const row of typeResult[0].values) {
        byType[row[0] as string] = row[1] as number;
      }
    }
    return { total, byType };
  },

  deleteOldestBeyond(maxCount: number): void {
    const count = getDatabase().exec('SELECT COUNT(*) FROM memories');
    const total = count.length > 0 ? (count[0].values[0][0] as number) : 0;
    if (total > maxCount) {
      getDatabase().run(
        `DELETE FROM memories WHERE id IN (
          SELECT id FROM memories ORDER BY importance ASC, last_accessed_at ASC LIMIT ?
        )`,
        [total - maxCount]
      );
      saveDatabase();
    }
  },

  clearAll(): void {
    getDatabase().run('DELETE FROM memories');
    forceSaveDatabase();
  },
};
