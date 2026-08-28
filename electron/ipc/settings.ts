/**
 * ipc/settings — 应用设置 / 系统操作 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { shell, app } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { settingsService } from '../services/settings-service';
import { forceSaveDatabase, clearConversationsAndMessages, resetDatabase } from '../database';
import { clearCache as clearWeReadApiCache } from '../weread-api';
import { refreshWereadAutoSyncTimer } from '../weread-sync-manager';
import { logger } from '../logger';
import type { HandleFn } from './types';

export function registerSettingsHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.SETTINGS.GET, (key: string) => settingsService.get(key));
  handle(IPC_CHANNELS.SETTINGS.SET, (key: string, value: unknown) => {
    settingsService.set(key, value);
    // 微信读书自动同步相关字段变更时，触发 main 进程更新定时器
    // （wereadApiKey 也可能影响定时器是否启动——未配置时定时器不会运行）
    if (key === 'wereadAutoSync' || key === 'wereadAutoSyncInterval' || key === 'wereadApiKey') {
      try {
        refreshWereadAutoSyncTimer();
      } catch (e) {
        logger.warn('refreshWereadAutoSyncTimer failed', { error: String(e) });
      }
    }
    return undefined;
  });
  handle(IPC_CHANNELS.SETTINGS.GET_ALL, () => settingsService.getAll());

  handle(IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE, () => {
    forceSaveDatabase();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.CLEAR_CACHE, () => {
    clearWeReadApiCache();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL, async (url: string) => {
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Invalid URL');
    }
    // Only allow http(s) / weread deep links — no file:// or arbitrary protocols
    if (!/^(https?:|weread:)/i.test(url)) {
      throw new Error('Only http(s) or weread: URLs allowed');
    }
    await shell.openExternal(url);
    return { opened: true };
  });

  handle(IPC_CHANNELS.SYSTEM.CLEAR_HISTORY, () => {
    clearConversationsAndMessages();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.RESET_DATABASE, () => {
    resetDatabase();
    // 给前端一点时间收到响应后再重启
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
    return { success: true };
  });
}
