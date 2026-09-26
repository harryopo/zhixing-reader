/**
 * database/knowledge-cards — 知识卡片表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { assertRealColumns } from './updatable-columns';

export const knowledgeCardsDb = {
  create(card: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO knowledge_cards (id, book_id, type, title, content, interpretation, application, related_card_ids, tags, source_highlight_id, review_count, mastery_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.book_id ?? card.bookId,
        card.type,
        card.title,
        card.content,
        card.interpretation ?? null,
        card.application ?? null,
        card.related_card_ids ?? card.relatedCardIds ? JSON.stringify(card.related_card_ids ?? card.relatedCardIds) : null,
        card.tags ? JSON.stringify(card.tags) : null,
        card.source_highlight_id ?? card.sourceHighlightId ?? null,
        card.review_count ?? card.reviewCount ?? 0,
        card.mastery_level ?? card.masteryLevel ?? 0,
      ]
    );
    saveDatabase();
  },

  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM knowledge_cards WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  /** 每本书有多少张知识卡片（判"成品是否还在"用；成品清空后台账进度就该作废） */
  getCountsByBook(): Record<string, number> {
    const result = getDatabase().exec('SELECT book_id, COUNT(*) FROM knowledge_cards GROUP BY book_id');
    const counts: Record<string, number> = {};
    if (result.length > 0) {
      for (const [bookId, count] of result[0].values) counts[String(bookId)] = Number(count);
    }
    return counts;
  },

  /**
   * 删除某本书的全部知识卡片，返回删除条数（单事务，符合 B12）。
   *
   * 用途：**"重新蒸馏"必须是真的替换**。此前蒸馏对每张卡都是纯 INSERT（id 还是新的随机串），
   * 所以对一本已经有卡片的书再点一次「重新蒸馏」，卡片会**成倍翻**（内容完全一样、id 不同）。
   * 界面写的是"重新"，数据侧却是"追加" —— 这类"看着一个意思、实际另一个意思"正是本项目
   * 一直在治的病。删除是破坏性操作，调用方必须先向用户确认。
   */
  deleteByBookId(bookId: string): number {
    const before = getDatabase().exec('SELECT COUNT(*) FROM knowledge_cards WHERE book_id = ?', [bookId]);
    const count = before.length > 0 ? Number(before[0].values[0][0]) || 0 : 0;
    if (count === 0) return 0;
    runTransaction((database) => {
      database.run('DELETE FROM knowledge_cards WHERE book_id = ?', [bookId]);
    });
    return count;
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT k.*, b.title as book_title FROM knowledge_cards k
       JOIN books b ON k.book_id = b.id
       ORDER BY k.updated_at DESC`
    );
    return rowsToObjects(result);
  },

  update(id: string, card: Record<string, unknown>): void {
    const fieldMap: Record<string, string> = {
      bookId: 'book_id',
      relatedCardIds: 'related_card_ids',
      sourceHighlightId: 'source_highlight_id',
      reviewCount: 'review_count',
      masteryLevel: 'mastery_level',
    };
    const updatableKeys = Object.keys(card).filter(k => k !== 'id');
    const columns = assertRealColumns('knowledge_cards', updatableKeys.map(k => fieldMap[k] ?? k));
    if (columns.length === 0) return;
    const setClauses = columns.map((c) => `${c} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = card[k];
      if (Array.isArray(val)) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE knowledge_cards SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  /**
   * 找回历史知识卡片的来源划线（2026-09-16 新增）。
   *
   * 背景：蒸馏时 `source_highlight_id` 写死 null，实测 90 张卡片来源全部为空，
   * 「划线 → 卡片」这条血缘链在数据层是断的。入口已修（改用 AI 返回的 sourceIndex），
   * 但已经生成的卡片不会自己变好 —— 它们需要一次回填。
   *
   * **为什么用「内容精确相等」而不是模糊匹配**：
   * 卡片内容若与本书某条划线**逐字节相同**，那就是同一条原文，是**可证明**的对应关系；
   * 而 `highlights` 在导入时就按 `(book_id, content)` 去重，所以书内匹配是**唯一**的。
   * 不做任何相似度猜测 —— 猜出来的溯源比没有溯源更糟。
   *
   * 只填空白项，不覆盖已有值；重复执行无副作用。返回补上的条数。
   */
  backfillSourceHighlights(): number {
    const db = getDatabase();
    const before = db.exec(
      "SELECT COUNT(*) FROM knowledge_cards WHERE source_highlight_id IS NOT NULL AND source_highlight_id != ''"
    );
    const beforeCount = before.length > 0 ? (before[0].values[0][0] as number) : 0;

    db.run(`
      UPDATE knowledge_cards
      SET source_highlight_id = (
        SELECT h.id FROM highlights h
        WHERE h.book_id = knowledge_cards.book_id AND h.content = knowledge_cards.content
        LIMIT 1
      ),
      updated_at = datetime('now')
      WHERE (source_highlight_id IS NULL OR source_highlight_id = '')
        AND EXISTS (
          SELECT 1 FROM highlights h
          WHERE h.book_id = knowledge_cards.book_id AND h.content = knowledge_cards.content
        )
    `);

    const after = db.exec(
      "SELECT COUNT(*) FROM knowledge_cards WHERE source_highlight_id IS NOT NULL AND source_highlight_id != ''"
    );
    const afterCount = after.length > 0 ? (after[0].values[0][0] as number) : 0;
    saveDatabase();
    return Math.max(0, afterCount - beforeCount);
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM knowledge_cards WHERE id = ?', [id]);
    saveDatabase();
  },
};
