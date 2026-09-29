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
  /*
    渲染层只可能发字符串（输入框的值），其他形状一律按"没有关键词"处理。
    原来这里写的是 `String(query ?? '')`：`{}` 会被变成一个用户从没打过的关键词
    `[object Object]`，而界面对它的回答是「库里没有找到相关内容」—— 又是一句关于
    用户数据的假话（搜不到 ≠ 没这个东西）。空查询在 `globalSearch` 里直接短路，
    所以"按没有关键词处理"不会退化成把全库倒出来。
  */
  handle(
    IPC_CHANNELS.SEARCH.GLOBAL,
    (query: string) => globalSearch(typeof query === 'string' ? query : ''),
  );
}
