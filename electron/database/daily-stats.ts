/**
 * database/daily-stats — 每日统计表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 *
 * `date` 这一列是**日历日键**，界面上「今天」那一格读的就是它。
 * 2026-10-17 起统一按**本地日**写（`localDayKey`）：此前这四个写入方用
 * `toISOString().split('T')[0]`（UTC 日），而读取侧（`recentDayKeys` / `localDateStr`）
 * 按本地日读，两边注释都写着"toISOString 会在 UTC+8 的凌晨把今天算成昨天"
 * ⇒ UTC+8 上每天 00:00–08:00 的划线、复习、读完一本书全被记进昨天那一格。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { localDayKey } from '../../src/shared/db-time';

/** 此刻属于本地哪一天 —— 只这一处算法，别在写入方各写一份 */
function todayKey(): string {
  return localDayKey(new Date());
}

export const dailyStatsDb = {
  getToday(): Record<string, unknown> | undefined {
    const today = todayKey();
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
    const today = todayKey();
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, books_read) VALUES (?, ?, 1)
       ON CONFLICT(date) DO UPDATE SET books_read = books_read + 1`,
      [`daily_${today}`, today]
    );
    saveDatabase();
  },

  incrementHighlightsAdded(count: number = 1): void {
    const today = todayKey();
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, highlights_added) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET highlights_added = highlights_added + ?`,
      [`daily_${today}`, today, count, count]
    );
    saveDatabase();
  },

  incrementCardsReviewed(count: number = 1): void {
    const today = todayKey();
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

  /**
   * 按 `remap` 把每一行的 `reading_time` 搬到它真正属于的那一天，返回搬动的行数。
   *
   * 只为一件事存在：旧口径把微信读书「北京零点」的 epoch 用 `toISOString()` 换算，
   * **整条阅读时长序列差一天**（实测 1788624000 = 2026-09-05T16:00Z = 北京 09-06 零点）。
   * 计数器三列（`books_read` / `highlights_added` / `cards_reviewed`）是活动当场写的，
   * 归属与 reading_time 不同，**一概不动**。
   *
   * 搬迁按快照两步做，不逐行就地改：`09-05 → 09-06`、`09-06 → 09-07` 这种链式映射，
   * 边读边写会把同一份值推两格。目标行已有值时**覆盖** —— 这一列的真值来源是微信读书，
   * 语义本来就是覆盖；相加会凭空多出一天的时长。
   *
   * `remap` 返回 `null` 或与原键相同 ⇒ 那一行不动：调用方用它表达"本来就对"，
   * 也让这一步在已修正的库上退化成空操作。
   */
  moveReadingTimeDays(remap: (day: string) => string | null): number {
    const db = getDatabase();
    const result = db.exec(
      'SELECT date, reading_time FROM daily_stats WHERE reading_time IS NOT NULL AND reading_time > 0'
    );
    const rows = result.length > 0 ? (result[0].values as Array<[string, number]>) : [];

    const plan = rows
      .map(([from, value]) => ({ from, to: remap(from), value }))
      .filter((step): step is { from: string; to: string; value: number } =>
        typeof step.to === 'string' && step.to !== step.from);

    if (plan.length === 0) return 0;

    for (const step of plan) {
      db.run('UPDATE daily_stats SET reading_time = 0 WHERE date = ?', [step.from]);
    }
    for (const step of plan) {
      db.run(
        `INSERT INTO daily_stats (id, date, reading_time) VALUES (?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET reading_time = ?`,
        [`daily_${step.to}`, step.to, step.value, step.value]
      );
    }
    saveDatabase();
    return plan.length;
  },
};
