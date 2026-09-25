/**
 * ipc/search — 跨内容的全局搜索
 *
 * 界面只给一个关键词，五类内容的命中一次拿回去。为什么不在渲染层逐类调五次
 * 各自的 search：那是把"哪些类算搜过、每类几条"这件事抄了五份，
 * 加一类要改界面，少一类也不会报错。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { globalSearch } from '../services/global-search';
import type { HandleFn } from './types';

export function registerSearchHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.SEARCH.GLOBAL, (query: string) => globalSearch(String(query ?? '')));
}
