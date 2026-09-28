/**
 * database/memories — AI 对话长期记忆表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, forceSaveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { toLikePattern } from '../../src/shared/global-search';

/** 与全局搜索、生词本同一把 LIKE：值走占位符，`%` `_` 已在 pattern 里转义，ESCAPE 不能省 */
const LIKE = `LIKE ? ESCAPE '\\'`;

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

  /**
   * 按分词找相关记忆。
   *
   * 召回是"命中任一分词"，排序就必须用**同一个**命中关系（命中的分词个数），
   * 命中数相同再按 importance。此前 SQL 只按 `importance DESC` 排，
   * "相关"两个字其实等于"含任一分词的行里最重要的 limit 条" —— 中文按 2 字滑窗
   * 分词，一个问句里的常用二字组几乎什么记忆都命中，于是界面那块「相关记忆」
   * 摆的其实是「最重记忆」。与 `services/global-search.ts` 的 `relevanceScore` 同一口径。
   *
   * 通配符按字面匹配（`toLikePattern` + `ESCAPE`），值一律走 `?` 占位符。
   */
  getRelevant(queryTerms: string[], limit: number = 10): Record<string, unknown>[] {
    if (queryTerms.length === 0) return [];
    const perTerm = queryTerms.map(() => `(content ${LIKE} OR category ${LIKE})`);
    // 每个分词的命中是 0/1，加起来就是"这条记忆答上了几个词"
    const hitCount = perTerm.join(' + ');
    const params: Array<string | number> = [
      ...queryTerms.flatMap((term) => [toLikePattern(term), toLikePattern(term)]),
      ...queryTerms.flatMap((term) => [toLikePattern(term), toLikePattern(term)]),
      limit,
    ];
    const sql =
      `SELECT * FROM memories WHERE ${perTerm.join(' OR ')} ` +
      `ORDER BY (${hitCount}) DESC, importance DESC LIMIT ?`;
    const result = getDatabase().exec(sql, params);
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
