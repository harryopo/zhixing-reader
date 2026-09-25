/**
 * ipc/fsrs — FSRS 算法参数 / 复习预览 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import type { ReviewCardFields } from '../../src/shared/review-sources';
import {
  setCustomParameters,
  resetParameters,
  getParameters,
  previewReviewRatings,
  cardFromFields,
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

  /**
   * 四种评分的间隔预览（不落库）。界面传回的就是队列里那张卡，形状由
   * `src/shared/review-sources.ts` 的 ReviewCardFields 定 —— 以前这里写着
   * "蛇形行与驼峰卡都接受"，而渲染层唯一调用方只可能传驼峰，蛇形那一支是从未走到的分支。
   */
  handle(
    IPC_CHANNELS.FSRS.PREVIEW_REVIEW_RATINGS,
    (card: ReviewCardFields) => previewReviewRatings(cardFromFields(card))
  );
}
