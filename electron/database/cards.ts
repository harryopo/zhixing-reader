/**
 * database/cards — FSRS 复习卡片表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { Card, cardFromDb, cardToRow, createCard, CardState } from '../fsrs-engine';

export const cardsDb = {
  getByHighlightId(highlightId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE highlight_id = ?',
      [highlightId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getById(id: string): Card | null {
    const result = getDatabase().exec('SELECT * FROM cards WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0] ? cardFromDb(rows[0]) : null;
  },

  create(highlightId: string): Card {
    const card = createCard(highlightId);
    const row = cardToRow(card);
    getDatabase().run(
      `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.highlight_id,
        row.state,
        row.step,
        row.stability,
        row.difficulty,
        row.due,
        row.last_review,
        row.elapsed_days,
        row.scheduled_days,
        row.reps,
        row.lapses,
      ]
    );
    saveDatabase();
    return card;
  },

  createBatch(highlightIds: string[]): Card[] {
    const cards: Card[] = [];
    runTransaction((database) => {
      const stmt = database.prepare(
        `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const highlightId of highlightIds) {
        const card = createCard(highlightId);
        const row = cardToRow(card);
        stmt.run([
          row.id,
          row.highlight_id,
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
        ]);
        cards.push(card);
      }

      stmt.free();
    });
    return cards;
  },

  update(card: Card): void {
    const row = cardToRow(card);
    getDatabase().run(
      `UPDATE cards SET state = ?, step = ?, stability = ?, difficulty = ?,
       due = ?, last_review = ?, elapsed_days = ?, scheduled_days = ?,
       reps = ?, lapses = ? WHERE id = ?`,
      [
        row.state,
        row.step,
        row.stability,
        row.difficulty,
        row.due,
        row.last_review,
        row.elapsed_days,
        row.scheduled_days,
        row.reps,
        row.lapses,
        row.id,
      ]
    );
    saveDatabase();
  },

  updateBatch(cards: Card[]): void {
    runTransaction((database) => {
      const stmt = database.prepare(
        `UPDATE cards SET state = ?, step = ?, stability = ?, difficulty = ?,
         due = ?, last_review = ?, elapsed_days = ?, scheduled_days = ?,
         reps = ?, lapses = ? WHERE id = ?`
      );

      for (const card of cards) {
        const row = cardToRow(card);
        stmt.run([
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
          row.id,
        ]);
      }

      stmt.free();
    });
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM cards WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM cards WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByHighlightId(highlightId: string): void {
    getDatabase().run('DELETE FROM cards WHERE highlight_id = ?', [highlightId]);
    saveDatabase();
  },

  createForExistingHighlights(): { created: number; skipped: number } {
    const result = getDatabase().exec(`
      SELECT h.id FROM highlights h
      LEFT JOIN cards c ON h.id = c.highlight_id
      WHERE c.id IS NULL
    `);
    const rows = rowsToObjects(result);
    const highlightIds = rows.map(r => r.id as string);

    if (highlightIds.length === 0) {
      return { created: 0, skipped: 0 };
    }

    const cards = this.createBatch(highlightIds);
    return { created: cards.length, skipped: rows.length - cards.length };
  },

  getDueCards(limit: number = 100): Card[] {
    const now = new Date().toISOString();
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?',
      [now, limit]
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  /**
   * 到期卡片（含复习内容）— 供间隔复习页面展示。
   * JOIN 划线原文 + 笔记 + 章节名 + 书名，FSRS 字段走 cardFromDb 驼峰转换。
   */
  getDueCardsWithContent(limit: number = 100): Array<Card & {
    bookId: string;
    bookTitle: string | null;
    chapterTitle: string | null;
    highlightContent: string;
    highlightNote: string | null;
  }> {
    const now = new Date().toISOString();
    const result = getDatabase().exec(
      `SELECT c.*, h.book_id AS _book_id, h.content AS _highlight_content,
              h.note AS _highlight_note, h.chapter_title AS _chapter_title,
              b.title AS _book_title
       FROM cards c
       JOIN highlights h ON c.highlight_id = h.id
       LEFT JOIN books b ON h.book_id = b.id
       WHERE c.due <= ?
       ORDER BY c.due ASC
       LIMIT ?`,
      [now, limit]
    );
    return rowsToObjects(result).map((row) => ({
      ...cardFromDb(row),
      bookId: row._book_id as string,
      bookTitle: (row._book_title as string) ?? null,
      chapterTitle: (row._chapter_title as string) ?? null,
      highlightContent: (row._highlight_content as string) ?? '',
      highlightNote: (row._highlight_note as string) ?? null,
    }));
  },

  getByBookId(bookId: string): Card[] {
    const result = getDatabase().exec(`
      SELECT c.* FROM cards c
      JOIN highlights h ON c.highlight_id = h.id
      WHERE h.book_id = ?
    `, [bookId]);
    return rowsToObjects(result).map(cardFromDb);
  },

  getReviewStats(): { total: number; due: number; new: number; learning: number; review: number } {
    const execScalar = (sql: string): number => {
      const result = getDatabase().exec(sql);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    const total = execScalar('SELECT COUNT(*) FROM cards');
    const due = execScalar("SELECT COUNT(*) FROM cards WHERE due <= datetime('now')");
    const newCards = execScalar('SELECT COUNT(*) FROM cards WHERE state = 0');
    const learning = execScalar('SELECT COUNT(*) FROM cards WHERE state = 1 OR state = 3');
    const review = execScalar('SELECT COUNT(*) FROM cards WHERE state = 2');

    return { total, due, new: newCards, learning, review };
  },

  updateApplicationTag(id: string, tag: string): void {
    getDatabase().run(
      'UPDATE cards SET application_tag = ? WHERE id = ?',
      [tag, id]
    );
    saveDatabase();
  },

  updateMasteryLevel(id: string, level: number): void {
    getDatabase().run(
      'UPDATE cards SET mastery_level = ? WHERE id = ?',
      [level, id]
    );
    saveDatabase();
  },

  getByState(state: CardState, limit?: number): Card[] {
    let sql = 'SELECT * FROM cards WHERE state = ? ORDER BY due ASC';
    const params: unknown[] = [state];

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = getDatabase().exec(sql, params);
    return rowsToObjects(result).map(cardFromDb);
  },

  getNewCards(limit: number = 20): Card[] {
    return this.getByState(CardState.New, limit);
  },

  getLearningCards(limit: number = 20): Card[] {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE state = ? OR state = ? ORDER BY due ASC LIMIT ?',
      [CardState.Learning, CardState.Relearning, limit]
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM cards');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};
