/**
 * ipc/fsrs — FSRS 算法参数 / 复习预览 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import {
  setCustomParameters,
  resetParameters,
  getParameters,
  previewReviewRatings,
  cardFromDb,
} from '../fsrs-engine';
import type { HandleFn } from './types';

export function registerFsrsHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.FSRS.SET_PARAMETERS, (params: Record<string, unknown>) => {
    setCustomParameters(params as Partial<import('../fsrs-engine').FSRSParameters>);
    return { success: true };
  });

  handle(IPC_CHANNELS.FSRS.RESET_PARAMETERS, () => {
    resetParameters();
    return { success: true };
  });

  handle(IPC_CHANNELS.FSRS.GET_PARAMETERS, () => {
    return getParameters();
  });

  handle(IPC_CHANNELS.FSRS.PREVIEW_REVIEW_RATINGS, (card: Record<string, unknown>) => {
    // Accept either DB snake_case rows or renderer camelCase cards
    const hasSnake = 'highlight_id' in card || 'scheduled_days' in card
    const typed = hasSnake
      ? cardFromDb(card)
      : (card as unknown as import('../fsrs-engine').Card)
    return previewReviewRatings(typed)
  });
}
