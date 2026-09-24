/**
 * ipc/settings — 应用设置 / 系统操作 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { shell, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { isSecretSetting, secretSetFlagName } from '../../src/shared/settings-secrets';
import { settingsService } from '../services/settings-service';
import { archiveAndDelete, restoreDeleted } from '../services/deleted-archive';
import { forceSaveDatabase, clearConversationsAndMessages, resetDatabase } from '../database';
import { clearCache as clearWeReadApiCache, setApiKey as setWereadApiKey } from '../weread-api';
import { refreshWereadAutoSyncTimer } from '../weread-sync-manager';
import { logger } from '../logger';
import type { UndoableDeleteKind } from '../../src/shared/types';
import type { HandleFn } from './types';

/**
 * 向量索引目录名（**遗留**）。
 *
 * Vectra 语义检索已于 2026-09-16 整套移除，这个目录不会再被写入；
 * 这里仍然量它的大小，只是为了让老用户的磁盘占用看得见（不显示在界面上了）。
 */
const VECTOR_INDEX_DIR = 'vectra-index';

export function registerSettingsHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.SETTINGS.GET, (key: string) => {
    // 密钥原值不出主进程：界面只该问「配没配」（走 getAll 的 *Set 字段）。
    // 这里直接抛而不是回 undefined —— 静默回空值会被界面读成"没配"，
    // 于是有一次手滑的保存就把用户的 key 清掉了。
    if (isSecretSetting(key)) {
      throw new Error(`密钥不跨进程下发：请改读 ${secretSetFlagName(key)}`);
    }
    return settingsService.get(key);
  });
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
  handle(IPC_CHANNELS.SETTINGS.GET_ALL, () => settingsService.getForRenderer());

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

  /**
   * 真实存储用量。
   *
   * 设置页原来那三个数字（12.3 / 45.2 / 128.5 MB）是**写死的常量**，
   * 旁边还放了个"刷新用量"按钮 —— 点了永远不变。这里改成真的去量文件大小。
   * 量不出来就返回 null，界面显示「—」，**不编数字**。
   */
  handle(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE, () => {
    const dirSize = (dir: string): number | null => {
      try {
        if (!fs.existsSync(dir)) return null;
        let total = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const sub = dirSize(full);
            if (sub !== null) total += sub;
          } else {
            total += fs.statSync(full).size;
          }
        }
        return total;
      } catch {
        return null;
      }
    };
    const fileSize = (file: string): number | null => {
      try {
        return fs.existsSync(file) ? fs.statSync(file).size : null;
      } catch {
        return null;
      }
    };

    const userData = app.getPath('userData');
    return {
      dbBytes: fileSize(path.join(userData, 'zhixing.db')),
      vectorBytes: dirSize(path.join(userData, VECTOR_INDEX_DIR)),
      logBytes: dirSize(path.join(userData, 'logs')),
    };
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

  // ===== 可撤销删除 =====
  // 现场只在主进程内存里，所以这两条通道的语义都是「本会话内有效」——
  // 界面据此把撤销的出口只放在删除后的那条提示上，不另做回收站页面。
  handle(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE, (kind: UndoableDeleteKind, id: string) =>
    archiveAndDelete(kind, id),
  );

  handle(IPC_CHANNELS.SYSTEM.RESTORE_DELETE, (token: string) => restoreDeleted(token));
}
