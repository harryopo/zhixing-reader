/**
 * ipc/settings — 应用设置 / 系统操作 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { shell, app } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { settingsService } from '../services/settings-service';
import { forceSaveDatabase, clearConversationsAndMessages, resetDatabase } from '../database';
import { clearCache as clearWeReadApiCache, setApiKey as setWereadApiKey } from '../weread-api';
import { refreshWereadAutoSyncTimer } from '../weread-sync-manager';
import { logger } from '../logger';
import type { HandleFn } from './types';

export function registerSettingsHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.SETTINGS.GET, (key: string) => settingsService.get(key));
  handle(IPC_CHANNELS.SETTINGS.SET, (key: string, value: unknown) => {
    settingsService.set(key, value);
    // 微信读书 API Key 变更时立即应用到 weread-api 内存单例：
    // 否则 getBookshelf 等同步走的是模块内存 apiKey（可能为空/旧值），需重启才生效——
    // 这正是“测试连接成功（直接传 key）但立即同步报未设置 Key（读内存）”的断层根因
    if (key === 'wereadApiKey') {
      try {
        setWereadApiKey(typeof value === 'string' ? value : '');
      } catch (e) {
        logger.warn('Apply wereadApiKey on settings.set failed', { error: String(e) });
      }
    }
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
    // resetDatabase 经事务只标记脏数据（3s 防抖落盘），而下方 500ms 后即 app.exit(0)，
    // 会先于防抖定时器执行导致重置结果未落盘（relaunch 后旧数据复现）——必须强制同步刷盘
    forceSaveDatabase();
    // 给前端一点时间收到响应后再重启
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
    return { success: true };
  });
}
