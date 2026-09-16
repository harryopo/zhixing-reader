/**
 * 启动时的一次性数据修复
 *
 * ## 为什么放在启动时
 * 2026-09-16 实测用户真实数据库发现三处"功能都在、数据全空"的断点：
 *  - 934 条划线的 `chapter_title` 全空
 *  - 90 张知识卡片的 `source_highlight_id` 全空
 *  - `daily_stats.reading_time` 恒为 0
 * 三处的补全入口此前只挂在「设置页按钮」或「每日自动同步」上。
 * 用户的原话是"我很多也看不懂"—— 把修复藏在设置页深处，等于不修。
 * 所以改成启动后自动跑一次，用户什么都不用点。
 *
 * ## 代价与自我收敛
 *  - 卡片来源：**纯本地 SQL**（一条 UPDATE，只填空值），零网络
 *  - 章节名：需要按书重新拉微信读书内容，但 `backfillChapterTitles()` 内部
 *    先查"哪些书还有缺口"，**没有缺口时一次请求都不发**
 *  - 阅读时长：1 次请求（月度统计）
 *  - 网络部分各自节流，避免每次启动都重复请求
 *
 * 全程 try/catch：修复失败不得影响应用启动。
 */

import { knowledgeCardsDb, highlightsDb } from '../database';
import { backfillChapterTitles } from './chapter-title-backfill';
import { syncReadingTimeToLocal } from './reading-time-sync';
import { settingsService } from './settings-service';
import { logger } from '../logger';

/** 章节名补全的节流：同一台机器 12 小时内最多尝试一次 */
const CHAPTER_ATTEMPT_KEY = 'chapterBackfillAttemptAt';
const CHAPTER_RETRY_MS = 12 * 60 * 60 * 1000;
/** 阅读时长的节流：微信读书按月统计，6 小时内不会变 */
const READING_TIME_ATTEMPT_KEY = 'readingTimeSyncAttemptAt';
const READING_TIME_RETRY_MS = 6 * 60 * 60 * 1000;

export interface StartupRepairResult {
  /** 补上来源划线的知识卡片数 */
  cardSources: number;
  /** 补上章节名的划线条数 */
  chapterTitles: number;
  /** 章节名补全是否因节流被跳过 */
  chapterSkipped: boolean;
  /** 阅读时长写入/更新的天数 */
  readingDays: number;
}

/** 节流判断：距上次尝试是否还没超过 intervalMs */
function throttled(key: string, intervalMs: number): boolean {
  const last = settingsService.get(key);
  return typeof last === 'number' && Date.now() - last < intervalMs;
}

async function repairKnowledgeCardSources(): Promise<number> {
  try {
    const updated = knowledgeCardsDb.backfillSourceHighlights();
    if (updated > 0) {
      logger.info('启动修复：知识卡片来源划线已补全', { updated });
    }
    return updated;
  } catch (error) {
    logger.warn('启动修复：知识卡片来源补全失败', { error: String(error) });
    return 0;
  }
}

async function repairChapterTitles(): Promise<{ updated: number; skipped: boolean }> {
  try {
    // 先看有没有缺口。没有缺口时这里就返回，一次微信读书请求都不发。
    const missing = highlightsDb.getBookIdsMissingChapterTitle();
    if (missing.length === 0) return { updated: 0, skipped: false };
    if (throttled(CHAPTER_ATTEMPT_KEY, CHAPTER_RETRY_MS)) {
      return { updated: 0, skipped: true };
    }
    settingsService.set(CHAPTER_ATTEMPT_KEY, Date.now());
    const result = await backfillChapterTitles();
    if (result.updated > 0) {
      logger.info('启动修复：划线章节名已补全', { ...result });
    }
    return { updated: result.updated, skipped: false };
  } catch (error) {
    logger.warn('启动修复：章节名补全失败', { error: String(error) });
    return { updated: 0, skipped: false };
  }
}

async function refreshReadingTime(): Promise<number> {
  try {
    if (throttled(READING_TIME_ATTEMPT_KEY, READING_TIME_RETRY_MS)) return 0;
    settingsService.set(READING_TIME_ATTEMPT_KEY, Date.now());
    const result = await syncReadingTimeToLocal();
    return result.days;
  } catch (error) {
    logger.warn('启动修复：阅读时长同步失败', { error: String(error) });
    return 0;
  }
}

let inFlight = false;

/**
 * 跑一轮启动修复。并发调用只会执行一次。
 *
 * 调用方**不要 await**：章节名与阅读时长要走网络，不能拖慢窗口出现。
 */
export async function runStartupRepair(): Promise<StartupRepairResult> {
  const result: StartupRepairResult = {
    cardSources: 0,
    chapterTitles: 0,
    chapterSkipped: false,
    readingDays: 0,
  };
  if (inFlight) return result;
  inFlight = true;
  try {
    result.cardSources = await repairKnowledgeCardSources();
    const chapter = await repairChapterTitles();
    result.chapterTitles = chapter.updated;
    result.chapterSkipped = chapter.skipped;
    result.readingDays = await refreshReadingTime();
  } finally {
    inFlight = false;
  }
  if (result.cardSources || result.chapterTitles || result.readingDays) {
    logger.info('启动修复完成', { ...result });
  }
  return result;
}
