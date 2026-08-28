/**
 * database/knowledge-cards — 知识卡片表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

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

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM knowledge_cards WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM knowledge_cards WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getByType(type: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM knowledge_cards WHERE type = ? ORDER BY updated_at DESC',
      [type]
    );
    return rowsToObjects(result);
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
    const setClauses = updatableKeys.map(k => `${fieldMap[k] ?? k} = ?`).join(', ');
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

  delete(id: string): void {
    getDatabase().run('DELETE FROM knowledge_cards WHERE id = ?', [id]);
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT k.*, b.title as book_title FROM knowledge_cards k
       JOIN books b ON k.book_id = b.id
       WHERE k.title LIKE ? OR k.content LIKE ? OR k.tags LIKE ?`,
      [pattern, pattern, pattern]
    );
    return rowsToObjects(result);
  },
};
