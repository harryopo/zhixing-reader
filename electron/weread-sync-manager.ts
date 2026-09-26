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
 *   - 写库的判重与字段映射**不在这里再写一份**，与手动同步共用
 *     `src/shared/weread-book-sync.ts` 的计划（两份实现漂开过：这里曾按书名判重、
 *     并在更新时把 progress 写成 0，抹掉按本查回来的真实进度）
 *   - 一次尝试之后没有留下成功记录 ⇒ 下一次按小时退避，不许 delay 算成 0 空转
 */

import { BrowserWindow } from 'electron';
import { getBookshelf, getApiKey } from './weread-api';
import { booksDb } from './database';
import { logger } from './logger';
import { settingsService } from './services/settings-service';
import { syncReadingTimeToLocal } from './services/reading-time-sync';
import { planBookSync } from '../src/shared/weread-book-sync';
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
/**
 * 本进程内最近一次自动同步的开始时刻（不论成败）。
 * 只在没有成功记录时用来退避：`wereadLastSyncAt` 只有同步真的跑完才写，
 * 光靠它排下一次，一次失败的 key 会把 delay 算成 0 ⇒ 排程链立刻重来，
 * 变成"不停地打微信读书接口 + 渲染层不停地弹自动同步失败"的空转循环。
 */
let lastAttemptAt = 0;

/** 后台同步：拉书架 → 写本地 books 表 */
async function syncWereadBookshelfBackground(): Promise<void> {
  lastAttemptAt = Date.now();
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
    let failedCount = 0;
    for (const wb of wereadBooks) {
      try {
        // 判重与字段映射与手动同步共用一份计划（src/shared/weread-book-sync.ts）
        const plan = planBookSync(wb, booksDb.getById(wb.bookId));
        if (plan.action === 'create') {
          booksDb.create(plan.fields);
          newCount++;
        } else {
          booksDb.update(plan.id, plan.fields);
          updatedCount++;
        }
      } catch (e) {
        failedCount++;
        logger.warn(`WeRead auto-sync: sync book failed for "${wb.title}"`, { error: String(e) });
      }
    }

    // 一本书都没写进去，就不许报"同步完成"—— 全失败时报 ok:true 是"假成功"
    //（手动同步那条 2026-09-20 已改成如实报失败数，这里同一口径）。
    if (failedCount === wereadBooks.length) {
      logger.error(`WeRead auto-sync failed: all ${wereadBooks.length} books could not be written`);
      emitAutoSyncStatus({
        ok: false,
        at: Date.now(),
        error: `书架上 ${wereadBooks.length} 本书全部写入失败（本地数据库可能被占用）`,
      });
      return;
    }

    // 顺带刷新本地阅读时长（每天一次，只有 1 次额外请求）。
    // 阅读时长的真值来源是微信读书，本地 daily_stats 只是它的缓存。
    await syncReadingTimeToLocal();

    logger.info(
      `WeRead auto-sync done: total=${wereadBooks.length} new=${newCount} updated=${updatedCount} failed=${failedCount}`,
    );
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
  // 有成功记录且没被调到未来 → 按频率排；否则（首次 / 时间异常）先试一次。
  const base = lastSyncAt && lastSyncAt <= now + frequencyMs
    ? lastSyncAt + frequencyMs
    : now;

  // 再压一道退避下限：本进程刚试过而没留下成功记录时（key 失效、网络不通、书架为空），
  // base 可能一直落在过去 ⇒ delay 恒为 0 ⇒ 排程链自己转成"立刻再打一次接口"的空转循环，
  // 渲染层跟着被刷屏弹「自动同步失败」。按小时退避，与每小时的兜底检查同一个节律。
  return Math.max(base, lastAttemptAt + HOURLY_CHECK_MS);
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

/**
 * 轻量兜底：每小时检查一次是否已到期。
 * 只由 `applyWereadAutoSyncSettings` 调用，且调用前那里已经清过旧定时器、
 * 也已经验过"开关开着 + 有 key" —— 这里不再重复那两道检查
 * （`scheduleNextSync` 的同类检查不能删：失败重试那条路会绕过 apply 直接回来排程）。
 */
function startHourlyCheck(): void {
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
