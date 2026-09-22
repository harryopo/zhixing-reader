/**
 * database/cards — FSRS 复习卡片表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { Card, cardFromDb, cardToRow, createCard, CardState } from '../fsrs-engine';
import { ReviewStats } from '../../src/shared/types';
import {
  DEFAULT_NEW_CARDS_PER_DAY,
  computeNewCardAllowance,
  normalizeNewCardsPerDay,
} from '../../src/shared/study-limits';

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

  /**
   * 今天已经引入的新卡数 —— 即**首次复习发生在今天**的卡片数。
   *
   * 为什么用 reviews 而不是 cards：一张卡只要评过一次分，state 就不再是 0，
   * 但它当天可能又被复习了好几次；只有"首次复习在今天的卡"才等于"今天新放出的卡"。
   * 时区口径与 daily-stats 保持一致（UTC 日期，见 daily-stats.ts）。
   */
  countNewIntroducedToday(): number {
    const today = new Date().toISOString().split('T')[0];
    const result = getDatabase().exec(
      `SELECT COUNT(*) FROM reviews r
       WHERE date(r.review_time) = ?
         AND r.review_time = (SELECT MIN(r2.review_time) FROM reviews r2 WHERE r2.card_id = r.card_id)`,
      [today]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /** 新卡池剩余量（state = 0，从未复习过） */
  countAvailableNewCards(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM cards WHERE state = 0');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /** 已学过且已到期的卡片数（真正的"复习卡"，不含新卡） */
  countDueReviewCards(): number {
    const result = getDatabase().exec(
      "SELECT COUNT(*) FROM cards WHERE state != 0 AND due <= datetime('now')"
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /**
   * 今日队列的构成。
   *
   * 2026-09-15 新增：此前界面只显示一个"待复习总数"，
   * 而那个数把 900+ 张从未学过的划线也算成了"你欠下的复习"——
   * 用户看到的是永远做不完的清单。现在拆成两块，各自有各自的语义。
   */
  getDueQueueStats(newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): {
    reviewDue: number;
    newAvailable: number;
    newIntroducedToday: number;
    newPerDay: number;
    newAllowance: number;
    actionable: number;
  } {
    const quota = computeNewCardAllowance({
      perDay: normalizeNewCardsPerDay(newCardsPerDay),
      introducedToday: this.countNewIntroducedToday(),
      available: this.countAvailableNewCards(),
    });
    const reviewDue = this.countDueReviewCards();
    return {
      reviewDue,
      newAvailable: quota.available,
      newIntroducedToday: quota.introducedToday,
      newPerDay: quota.perDay,
      newAllowance: quota.allowance,
      actionable: reviewDue + quota.allowance,
    };
  },

  /**
   * 今日实际要复习的卡片。
   *
   * 顺序：**先到期的复习卡，后新卡**——复习卡是时间敏感的（正在遗忘），
   * 新卡早一天晚一天没有区别。
   * 新卡每天最多放 `newCardsPerDay` 张（默认 15），剩余排队等明天。
   */
  getDueCards(limit: number = 100, newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): Card[] {
    const now = new Date().toISOString();
    const reviewResult = getDatabase().exec(
      `SELECT c.*, h.book_id AS book_id
       FROM cards c JOIN highlights h ON c.highlight_id = h.id
       WHERE c.state != 0 AND c.due <= ? ORDER BY c.due ASC LIMIT ?`,
      [now, limit]
    );
    const reviewCards = rowsToObjects(reviewResult).map(cardFromDb);

    const remaining = limit - reviewCards.length;
    if (remaining <= 0) return reviewCards;

    const quota = computeNewCardAllowance({
      perDay: normalizeNewCardsPerDay(newCardsPerDay),
      introducedToday: this.countNewIntroducedToday(),
      available: this.countAvailableNewCards(),
    });
    const newTake = Math.min(remaining, quota.allowance);
    if (newTake <= 0) return reviewCards;

    const newResult = getDatabase().exec(
      `SELECT c.*, h.book_id AS book_id
       FROM cards c JOIN highlights h ON c.highlight_id = h.id
       WHERE c.state = 0 ORDER BY c.created_at ASC, c.id ASC LIMIT ?`,
      [newTake]
    );
    return [...reviewCards, ...rowsToObjects(newResult).map(cardFromDb)];
  },

  /**
   * 到期卡片（含复习内容）— 供间隔复习页面展示。
   * JOIN 划线原文 + 笔记 + 章节名 + 书名，FSRS 字段走 cardFromDb 驼峰转换。
   */
  getDueCardsWithContent(limit: number = 100, newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): Array<Card & {
    bookId: string;
    bookTitle: string | null;
    chapterTitle: string | null;
    highlightContent: string;
    highlightNote: string | null;
  }> {
    // 先取 id 队列（复习卡优先，新卡按每日上限放行），再补上展示所需的内容字段
    const queue = this.getDueCards(limit, newCardsPerDay);
    if (queue.length === 0) return [];

    const placeholders = queue.map(() => '?').join(',');
    const result = getDatabase().exec(
      `SELECT c.*, h.book_id AS _book_id, h.content AS _highlight_content,
              h.note AS _highlight_note, h.chapter_title AS _chapter_title,
              b.title AS _book_title
       FROM cards c
       JOIN highlights h ON c.highlight_id = h.id
       LEFT JOIN books b ON h.book_id = b.id
       WHERE c.id IN (${placeholders})`,
      queue.map((card) => card.id)
    );
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rowsToObjects(result)) byId.set(row.id as string, row);

    // 按队列顺序输出，保持"复习卡在前、新卡在后"
    return queue.map((card) => {
      const row = byId.get(card.id) ?? {};
      return {
        ...card,
        bookId: (row._book_id as string) ?? '',
        bookTitle: (row._book_title as string) ?? null,
        chapterTitle: (row._chapter_title as string) ?? null,
        highlightContent: (row._highlight_content as string) ?? '',
        highlightNote: (row._highlight_note as string) ?? null,
      };
    });
  },

  getByBookId(bookId: string): Card[] {
    const result = getDatabase().exec(`
      SELECT c.*, h.book_id AS book_id FROM cards c
      JOIN highlights h ON c.highlight_id = h.id
      WHERE h.book_id = ?
    `, [bookId]);
    return rowsToObjects(result).map(cardFromDb);
  },

  getReviewStats(): ReviewStats {
    const execScalar = (sql: string): number => {
      const result = getDatabase().exec(sql);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    const total = execScalar('SELECT COUNT(*) FROM cards');
    // ⚠️ due 的语义已修正：只统计**已学过且到期**的复习卡。
    // 原先是 "WHERE due <= now"，把所有从未学过的划线也算成"到期"，
    // 让统计页显示 900+ 的待复习量。新卡归入 new 字段，不再混入 due。
    const due = execScalar("SELECT COUNT(*) FROM cards WHERE state != 0 AND due <= datetime('now')");
    const newCards = execScalar('SELECT COUNT(*) FROM cards WHERE state = 0');
    const learning = execScalar('SELECT COUNT(*) FROM cards WHERE state = 1 OR state = 3');
    const review = execScalar('SELECT COUNT(*) FROM cards WHERE state = 2');

    return { total, due, new: newCards, learning, review };
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
