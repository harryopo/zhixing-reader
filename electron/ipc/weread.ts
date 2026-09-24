/**
 * ipc/weread — 微信读书 API / 阅读数据 / 阅读数据 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { booksDb } from '../database';
import { logger } from '../logger';
import {
  getBookshelf,
  getBookProgress,
  fetchAllContent,
  fetchAllContentBatch,
  testConnection as testWereadConnection,
  fetchReadingData,
  ReadingMode,
  fetchRecommendations,
  fetchUserProfile,
} from '../weread-api';
import type { HandleFn } from './types';

export function registerWereadHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.WEREAD.GET_BOOKSHELF, () => getBookshelf());
  handle(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, (bookId: string) => fetchAllContent(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_RECOMMENDATIONS, () => fetchRecommendations());
  handle(IPC_CHANNELS.WEREAD.GET_USER_PROFILE, () => fetchUserProfile());
  handle(IPC_CHANNELS.WEREAD.TEST, (cookies: string) => testWereadConnection(cookies));
  handle(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT_BATCH, (bookIds: string[]) => {
    return fetchAllContentBatch(bookIds);
  });

  // 单本阅读进度：查询后回写本地库做缓存，下次直接读库即可
  handle(IPC_CHANNELS.WEREAD.GET_BOOK_PROGRESS, async (bookId: string) => {
    if (!bookId) return 0;
    const progress = await getBookProgress(bookId);
    try {
      booksDb.updateProgress(bookId, progress);
    } catch (error) {
      logger.warn('Failed to cache book progress', { bookId, error });
    }
    return progress;
  });

  handle(IPC_CHANNELS.READING_DATA.FETCH, (mode: ReadingMode, baseTime?: number) => fetchReadingData(mode, baseTime));
  // 总体统计：顺带把微信读书的每日阅读时长写回本地 daily_stats，
}
