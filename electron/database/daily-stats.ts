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

  /**
   * 写入某一天的阅读时长（**覆盖**，不是累加）。
   *
   * 2026-09-16 语义修正：`reading_time` 的**唯一真值来源是微信读书**
   * （`/readdata/detail` 的 readTimes）。本应用没有内置阅读器 ——
   * 书是在微信读书里读的，App 自己测不出「读了多少分钟」。
   * 所以这里是用微信读书的统计值覆盖本地记录，不做加法。
   *
   * 原先的 `addReadingTime`（累加）已随之移除：同一列有两个语义相反的写入方，
   * 迟早会算出错误数字；而且它整条链路（通道/handler/preload）从未被调用过。
   */
  upsertReadingTime(date: string, seconds: number): void {
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, reading_time) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET reading_time = ?`,
      [`daily_${day}`, day, value, value]
    );
    saveDatabase();
  },
};
