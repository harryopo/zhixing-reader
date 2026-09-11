/**
 * ipc/weread — 微信读书 API / 阅读数据 / 阅读数据 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { booksDb } from '../database';
import { logger } from '../logger';
import {
  setApiKey,
  getBookshelf,
  getBookProgress,
  fetchBookmarks,
  fetchNotes,
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
  handle(IPC_CHANNELS.WEREAD.SET_API_KEY, (apiKey: string) => setApiKey(apiKey));
  handle(IPC_CHANNELS.WEREAD.GET_BOOKSHELF, () => getBookshelf());
  handle(IPC_CHANNELS.WEREAD.FETCH_BOOKMARKS, (bookId: string) => fetchBookmarks(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_NOTES, (bookId: string) => fetchNotes(bookId));
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
  handle(IPC_CHANNELS.READING_DATA.FETCH_WEEKLY, (baseTime?: number) => fetchReadingData('weekly', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_MONTHLY, (baseTime?: number) => fetchReadingData('monthly', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_ANNUALLY, (baseTime?: number) => fetchReadingData('annually', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_OVERALL, () => fetchReadingData('overall'));
}
