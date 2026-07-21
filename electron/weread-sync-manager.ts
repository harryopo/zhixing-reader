/**
 * weread-sync-manager — 微信读书自动同步定时器（main 进程后台任务）
 *
 * 职责：
 *   1. 按 settings.wereadAutoSync / wereadAutoSyncInterval 启动/停止 setInterval
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
 *   - 单 setInterval，启动/停止都是幂等操作
 *   - 未配置 wereadApiKey 时拒绝启动，避免空跑报错刷屏
 *   - 最小间隔 5 分钟，防止打爆网关
 */

import { getBookshelf, getApiKey } from './weread-api';
import { booksDb } from './database';
import { logger } from './logger';
import { settingsService } from './services/settings-service';

let wereadAutoSyncTimer: NodeJS.Timeout | null = null;

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
  } catch (error) {
    logger.error('WeRead auto-sync failed', error);
  }
}

/** 读取 settings 并按需启动/停止定时器（幂等） */
function applyWereadAutoSyncSettings(): void {
  const settings = settingsService.getAll();
  const enabled = settings.wereadAutoSync === true;
  const intervalMin = typeof settings.wereadAutoSyncInterval === 'number' && settings.wereadAutoSyncInterval > 0
    ? settings.wereadAutoSyncInterval
    : 30;

  // 先清掉旧定时器（无论是否开启都先清，避免重复）
  if (wereadAutoSyncTimer) {
    clearInterval(wereadAutoSyncTimer);
    wereadAutoSyncTimer = null;
    logger.info('WeRead auto-sync timer cleared');
  }

  if (!enabled) {
    return;
  }

  // 未配置 API Key 时拒绝启动（避免空跑报错刷屏）
  if (!getApiKey()) {
    logger.warn('WeRead auto-sync enabled but API Key is missing, timer not started');
    return;
  }

  // 限定 5 分钟最小间隔，防止用户填入过短值打爆网关
  const safeIntervalMin = Math.max(5, intervalMin);
  const intervalMs = safeIntervalMin * 60 * 1000;
  wereadAutoSyncTimer = setInterval(() => {
    void syncWereadBookshelfBackground();
  }, intervalMs);
  logger.info(`WeRead auto-sync timer started (interval=${safeIntervalMin} min)`);
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
    clearInterval(wereadAutoSyncTimer);
    wereadAutoSyncTimer = null;
    logger.info('WeRead auto-sync timer stopped on quit');
  }
}
