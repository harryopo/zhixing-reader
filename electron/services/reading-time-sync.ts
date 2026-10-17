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
import { localDayKey } from '../../src/shared/db-time';

export interface ReadingTimeSyncResult {
  /** 写入/更新的天数 */
  days: number;
  /** 这些天的总秒数 */
  totalSeconds: number;
}

/**
 * 微信读书的 readTimes 键 → 那一天。
 *
 * 2026-10-17 口径修正：那些 epoch 是**北京零点**（实测 1788624000 % 86400 = 57600 = 16:00 UTC，
 * 七个键全是同一时刻 ⇒ 它是按东八区的日历天分桶的）。
 * 旧写法 `d.toISOString().split('T')[0]` 取的是 UTC 日，于是**每一天的阅读时长整体被记到前一天**。
 * 现在走 `localDayKey`，与 `daily_stats` 其余写入方、以及界面读它的那一把尺同一个口径。
 */
function epochSecondsToDate(epoch: unknown): string | null {
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return localDayKey(d);
}

/**
 * 旧口径留下的键（UTC 日）对应到那一天真正属于的本地日。
 *
 * 库里的行只剩日期串，那一刻的 epoch 已经不在，所以按"来源的分桶点是北京零点 = 16:00 UTC"
 * 反推那一 instant。机器本身在 UTC 时反推结果与原键相同 ⇒ 返回 null，搬迁退化成空操作。
 */
export function legacyReadingTimeDayKey(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const reconstructed = new Date(`${day}T16:00:00Z`);
  if (Number.isNaN(reconstructed.getTime())) return null;
  const fixed = localDayKey(reconstructed);
  return fixed === day ? null : fixed;
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
