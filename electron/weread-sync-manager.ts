/**
 * weread-sync-manager — 微信读书自动同步定时器（main 进程后台任务）
 *
 * 职责：
 *   1. 按 settings.wereadAutoSync / wereadSyncFrequency 启动/停止基于「下一次执行时间」的 setTimeout 调度
 *   2. 后台调 getBookshelf() → booksDb 写库（与渲染进程 sync-bookshelf.ts 行为对齐）
 *   3. 应用退出时清理定时器
 *
 * 触发点：
 *   - main.ts app.whenReady → initFromSettings 后调 startWereadAutoSync
 *   - ipc.ts SETTINGS.SET 检测 weread* key 变化 → refreshWereadAutoSyncTimer
 *   - main.ts before-quit → stopWereadAutoSync
 *
 * 设计决策：
 *   - 独立模块，避免 main ↔ ipc 循环依赖
 *   - 基于下一次执行时间调度，避免长时间占用内存跑倒计时
 *   - 未配置 wereadApiKey 时拒绝启动，避免空跑报错刷屏
 *   - 每小时兜底检查一次，防止系统时间调整或错过执行
 */

import { BrowserWindow } from 'electron';
import { getBookshelf, getApiKey } from './weread-api';
import { booksDb } from './database';
import { logger } from './logger';
import { settingsService } from './services/settings-service';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

export type WeReadSyncFrequency = '1d' | '3d' | '7d';

export interface WereadAutoSyncStatus {
  ok: boolean;
  at: number;
  error?: string;
  total?: number;
  newCount?: number;
  updatedCount?: number;
}

/** 广播自动同步结果到所有渲染窗口（窗口销毁时静默跳过） */
function emitAutoSyncStatus(status: WereadAutoSyncStatus): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.WEREAD.AUTO_SYNC_STATUS, status);
      }
    }
  } catch (e) {
    logger.warn('Failed to emit weread auto-sync status', { error: String(e) });
  }
}

const FREQUENCY_MS: Record<WeReadSyncFrequency, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const HOURLY_CHECK_MS = 60 * 60 * 1000;
const SYNC_AT_KEY = 'wereadLastSyncAt';
const FREQUENCY_KEY = 'wereadSyncFrequency';

let wereadAutoSyncTimer: NodeJS.Timeout | null = null;
let wereadHourlyCheckTimer: NodeJS.Timeout | null = null;

/** 后台同步：拉书架 → 写本地 books 表 */
async function syncWereadBookshelfBackground(): Promise<void> {
  if (!getApiKey()) {
    logger.warn('WeRead auto-sync skipped: API Key missing');
    return;
  }
  try {
    const wereadBooks = await getBookshelf();
    if (!wereadBooks || wereadBooks.length === 0) {
      logger.info('WeRead auto-sync: bookshelf empty, nothing to do');
      return;
    }

    let newCount = 0;
    let updatedCount = 0;
    for (const wb of wereadBooks) {
      try {
        // booksDb.search 按 title 模糊匹配，这里精确比对 title 判重
        const existing = booksDb.search(wb.title);
        const exists = existing.some((b) => b.title === wb.title);
        const readTime = wb.readUpdateTime || wb.lastReadTime || 0;
        const lastReadTimeStr = readTime > 0 ? new Date(readTime * 1000).toISOString() : null;

        if (!exists) {
          booksDb.create({
            id: wb.bookId,
            title: wb.title,
            author: wb.author,
            cover: wb.cover,
            isbn: wb.isbn,
            publisher: wb.publisher,
            publish_date: wb.publishTime || null,
            description: wb.intro || null,
            category: wb.category || null,
            reading_progress: wb.progress || 0,
            total_chapter: wb.totalChapter || 0,
            last_read_time: lastReadTimeStr,
            is_finished: wb.finishReading || 0,
          });
          newCount++;
        } else {
          const match = existing.find((b) => b.title === wb.title);
          if (match && match.id) {
            try {
              booksDb.update(match.id as string, {
                author: wb.author || null,
                cover: wb.cover || null,
                isbn: wb.isbn || null,
                publisher: wb.publisher || null,
                publish_date: wb.publishTime || null,
                description: wb.intro || null,
                category: wb.category || null,
                reading_progress: wb.progress || 0,
                last_read_time: lastReadTimeStr,
                is_finished: wb.finishReading || 0,
              });
              updatedCount++;
            } catch (e) {
              logger.warn(`WeRead auto-sync: update failed for "${wb.title}"`, { error: String(e) });
            }
          }
        }
      } catch (e) {
        logger.warn(`WeRead auto-sync: sync book failed for "${wb.title}"`, { error: String(e) });
      }
    }

    logger.info(`WeRead auto-sync done: total=${wereadBooks.length} new=${newCount} updated=${updatedCount}`);
    settingsService.set(SYNC_AT_KEY, Date.now());
    emitAutoSyncStatus({ ok: true, at: Date.now(), total: wereadBooks.length, newCount, updatedCount });
  } catch (error) {
    logger.error('WeRead auto-sync failed', error);
    emitAutoSyncStatus({
      ok: false,
      at: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseFrequency(value: unknown): WeReadSyncFrequency {
  if (value === '1d' || value === '3d' || value === '7d') {
    return value;
  }
  // 向后兼容：旧版本使用分钟数
  if (typeof value === 'number' && value > 0) {
    const days = value / 60 / 24;
    if (days < 2) return '1d';
    if (days < 5) return '3d';
    return '7d';
  }
  return '1d';
}

function getFrequencyMs(value: unknown): number {
  const freq = parseFrequency(value);
  return FREQUENCY_MS[freq];
}

/** 计算下一次同步时间戳 */
function getNextSyncTimeMs(): number {
  const settings = settingsService.getAll();
  const frequencyMs = getFrequencyMs(settings[FREQUENCY_KEY]);
  const lastSyncAt = typeof settings[SYNC_AT_KEY] === 'number'
    ? settings[SYNC_AT_KEY] as number
    : 0;

  const now = Date.now();
  if (!lastSyncAt || lastSyncAt > now + frequencyMs) {
    // 无记录或系统时间被调到未来，下次从当前时间开始
    return now;
  }
  return lastSyncAt + frequencyMs;
}

/** 调度下一次同步 */
function scheduleNextSync(): void {
  if (wereadAutoSyncTimer) {
    clearTimeout(wereadAutoSyncTimer);
    wereadAutoSyncTimer = null;
  }

  const settings = settingsService.getAll();
  const enabled = settings.wereadAutoSync === true;
  if (!enabled || !getApiKey()) {
    return;
  }

  const nextTime = getNextSyncTimeMs();
  const now = Date.now();
  const delay = Math.max(0, Math.min(nextTime - now, Number.MAX_SAFE_INTEGER));
  const freq = parseFrequency(settings[FREQUENCY_KEY]);

  wereadAutoSyncTimer = setTimeout(() => {
    void syncWereadBookshelfBackground().then(scheduleNextSync);
  }, delay);
  logger.info(`WeRead auto-sync scheduled: frequency=${freq}, nextAt=${new Date(nextTime).toISOString()}, delayMs=${delay}`);
}

/** 轻量兜底：每小时检查一次是否已到期 */
function startHourlyCheck(): void {
  if (wereadHourlyCheckTimer) {
    clearInterval(wereadHourlyCheckTimer);
    wereadHourlyCheckTimer = null;
  }

  const settings = settingsService.getAll();
  const enabled = settings.wereadAutoSync === true;
  if (!enabled || !getApiKey()) {
    return;
  }

  wereadHourlyCheckTimer = setInterval(() => {
    const nextTime = getNextSyncTimeMs();
    if (Date.now() >= nextTime) {
      void syncWereadBookshelfBackground().then(scheduleNextSync);
    }
  }, HOURLY_CHECK_MS);
}

/** 读取 settings 并按需启动/停止定时器（幂等） */
function applyWereadAutoSyncSettings(): void {
  // 先清掉旧定时器（无论是否开启都先清，避免重复）
  if (wereadAutoSyncTimer) {
    clearTimeout(wereadAutoSyncTimer);
    wereadAutoSyncTimer = null;
  }
  if (wereadHourlyCheckTimer) {
    clearInterval(wereadHourlyCheckTimer);
    wereadHourlyCheckTimer = null;
  }

  const settings = settingsService.getAll();
  const enabled = settings.wereadAutoSync === true;

  if (!enabled) {
    logger.info('WeRead auto-sync disabled');
    return;
  }

  // 未配置 API Key 时拒绝启动（避免空跑报错刷屏）
  if (!getApiKey()) {
    logger.warn('WeRead auto-sync enabled but API Key is missing, timer not started');
    return;
  }

  scheduleNextSync();
  startHourlyCheck();
}

/** 应用启动时调用：根据当前 settings 决定是否启动定时器 */
export function startWereadAutoSync(): void {
  applyWereadAutoSyncSettings();
}

/** settings 变更后调用：重新读取 settings 并刷新定时器（启动/停止/调整间隔） */
export function refreshWereadAutoSyncTimer(): void {
  applyWereadAutoSyncSettings();
}

/** 应用退出时调用：清理定时器，避免进程挂死 */
export function stopWereadAutoSync(): void {
  if (wereadAutoSyncTimer) {
    clearTimeout(wereadAutoSyncTimer);
    wereadAutoSyncTimer = null;
  }
  if (wereadHourlyCheckTimer) {
    clearInterval(wereadHourlyCheckTimer);
    wereadHourlyCheckTimer = null;
  }
  logger.info('WeRead auto-sync timer stopped on quit');
}
