/**
 * ipc/stats — 每日统计 / Token 用量 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { dailyStatsDb, tokenUsageDb } from '../database';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import type { HandleFn } from './types';

export function registerStatsHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.DAILY_STATS.GET_TODAY, () => dailyStatsDb.getToday());
  handle(IPC_CHANNELS.DAILY_STATS.GET_RANGE, (startDate: string, endDate: string) =>
    dailyStatsDb.getRange(startDate, endDate)
  );
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_BOOKS, () => dailyStatsDb.incrementBooksRead());
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_HIGHLIGHTS, (count?: number) =>
    dailyStatsDb.incrementHighlightsAdded(count)
  );
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_CARDS, (count?: number) =>
    dailyStatsDb.incrementCardsReviewed(count)
  );
  handle(IPC_CHANNELS.DAILY_STATS.ADD_READING_TIME, (seconds: number) =>
    dailyStatsDb.addReadingTime(seconds)
  );

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_RECENT, (limit?: number) => {
    return tokenUsageDb.getRecent(limit);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_BY_DATE_RANGE, (startDate: string, endDate: string) => {
    return tokenUsageDb.getByDateRange(startDate, endDate);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_PROVIDER, () => {
    return tokenUsageDb.getStatsByProvider();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_FEATURE, () => {
    return tokenUsageDb.getStatsByFeature();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_DAILY_STATS, (days?: number) => {
    return tokenUsageDb.getDailyStats(days);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_TOTAL_STATS, () => {
    return tokenUsageDb.getTotalStats();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.CLEAR_ALL, () => {
    tokenUsageDb.clearAll();
    return { success: true };
  });
}
