/**
 * database/daily-stats — 每日统计表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export const dailyStatsDb = {
  getToday(): Record<string, unknown> | undefined {
    const today = new Date().toISOString().split('T')[0];
    const result = getDatabase().exec('SELECT * FROM daily_stats WHERE date = ?', [today]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getRange(startDate: string, endDate: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC',
      [startDate, endDate]
    );
    return rowsToObjects(result);
  },

  incrementBooksRead(): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, books_read) VALUES (?, ?, 1)
       ON CONFLICT(date) DO UPDATE SET books_read = books_read + 1`,
      [`daily_${today}`, today]
    );
    saveDatabase();
  },

  incrementHighlightsAdded(count: number = 1): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, highlights_added) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET highlights_added = highlights_added + ?`,
      [`daily_${today}`, today, count, count]
    );
    saveDatabase();
  },

  incrementCardsReviewed(count: number = 1): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, cards_reviewed) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET cards_reviewed = cards_reviewed + ?`,
      [`daily_${today}`, today, count, count]
    );
    saveDatabase();
  },

  addReadingTime(seconds: number): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, reading_time) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET reading_time = reading_time + ?`,
      [`daily_${today}`, today, seconds, seconds]
    );
    saveDatabase();
  },
};
