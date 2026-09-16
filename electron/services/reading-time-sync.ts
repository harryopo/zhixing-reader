/**
 * 阅读时长同步 —— 把微信读书的阅读统计写回本地
 *
 * ## 背景（2026-09-16 实测发现）
 * 统计页把「阅读时长」当 KPI 展示，但 `daily_stats.reading_time` **永远是 0**：
 * 那条写入链路（IPC 通道 → handler → `addReadingTime`）缺了 preload 暴露，
 * 渲染层根本调不到，等于从没被调用过。
 *
 * 而同期页面上的另两处（readTimes 折线、导出报告）用的却是微信读书返回的
 * `totalReadTime` / `readTimes` —— **同一个指标两个来源，其中一个是死的**。
 *
 * ## 真值来源的判定
 * 本应用**没有内置阅读器**（书是在微信读书里读的，App 只能外开链接）。
 * 因此 App 自己无法测量"读了多少分钟"—— 唯一诚实的来源就是微信读书的阅读统计。
 * 实测 `/readdata/detail?mode=monthly` 返回的 `readTimes` 是
 * `{ Unix秒级时间戳: 秒数 }`，例如 7 天、共 3252 秒。这是真数据。
 *
 * 所以本模块做的事是：**用它覆盖写入本地 daily_stats**，让所有读这张表的地方
 * （KPI、7 天柱状图、个人档案、热力图）口径一致。
 *
 * 取 monthly 而不是 weekly：实测 weekly 窗口可能为空（本周还没读），
 * 而 monthly 覆盖当月每一天，信息量最大。
 */

import { fetchReadingData } from '../weread-api';
import { dailyStatsDb } from '../database';
import { logger } from '../logger';

export interface ReadingTimeSyncResult {
  /** 写入/更新的天数 */
  days: number;
  /** 这些天的总秒数 */
  totalSeconds: number;
}

/** Unix 秒级时间戳 → YYYY-MM-DD（与 daily_stats 其他写入方一致，走 UTC 日期） */
function epochSecondsToDate(epoch: unknown): string | null {
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/**
 * 拉取微信读书的阅读统计并覆盖写入本地 daily_stats。
 *
 * 失败时不抛错 —— 阅读时长同步失败不该影响调用方的主流程（取阅读数据 / 同步书架）。
 */
export async function syncReadingTimeToLocal(): Promise<ReadingTimeSyncResult> {
  const result: ReadingTimeSyncResult = { days: 0, totalSeconds: 0 };
  try {
    const data = await fetchReadingData('monthly');
    const readTimes = data?.readTimes ?? {};
    for (const [epoch, seconds] of Object.entries(readTimes)) {
      const date = epochSecondsToDate(epoch);
      if (!date) continue;
      const value = Math.max(0, Math.round(Number(seconds) || 0));
      dailyStatsDb.upsertReadingTime(date, value);
      result.days++;
      result.totalSeconds += value;
    }
    logger.info('阅读时长同步完成', { ...result });
  } catch (error) {
    logger.warn('阅读时长同步失败（不影响主流程）', { error: String(error) });
  }
  return result;
}
