/**
 * database/connection — 连接生命周期与事务原语
 * 从原 database.ts（2400+ 行）拆分而来，逻辑保持不变。
 *
 * 职责：sql.js 连接单例、防抖落盘、事务、测试注入。
 * schema/建表/迁移见 schema.ts；各领域 db 对象见同目录其他文件。
 */
import { Database } from 'sql.js';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

let db: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;
let isDirty = false;
let testDb: Database | null = null;
const SAVE_DELAY = 3000;
// 落盘失败重试：指数退避（3s→6s→…→上限 60s），避免磁盘满/权限/被占用导致静默丢数据
const MAX_RETRY_DELAY = 60000;
let retryTimeout: NodeJS.Timeout | null = null;
let retryDelay = SAVE_DELAY;
// 同一失败串只通知一次，避免重试期间 toast 刷屏
let persistErrorNotified = false;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'zhixing.db');
}

/** 广播落盘失败到所有渲染窗口（无窗口/窗口销毁时静默跳过），让用户知晓而非静默丢数据 */
function broadcastPersistError(message: string, willRetry: boolean, retryInMs: number): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SYSTEM.PERSIST_ERROR, { message, willRetry, retryInMs });
      }
    }
  } catch (e) {
    logger.warn('Failed to broadcast persist error', { error: String(e) });
  }
}

/** 调度一次指数退避重试，返回本次重试的延时（ms） */
function schedulePersistRetry(): number {
  if (retryTimeout) return retryDelay;
  const delay = retryDelay;
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    persistToDisk();
  }, delay);
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  return delay;
}

function markDirty(): void {
  isDirty = true;
  // 新写操作由防抖定时器接管，取消挂起的重试（退避计数保留至下次成功落盘）
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    persistToDisk();
    saveTimeout = null;
  }, SAVE_DELAY);
}

function persistToDisk(): void {
  if (!db || !isDirty) return;
  try {
    const data = db.export();
    fs.writeFileSync(getDatabasePath(), Buffer.from(data));
    isDirty = false;
    // 落盘成功：清理重试状态与失败通知标记
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    retryDelay = SAVE_DELAY;
    persistErrorNotified = false;
    logger.debug('Database saved to disk');
  } catch (error) {
    logger.error('Failed to save database', { error: String(error) });
    // 保持 isDirty=true：调度退避重试；失败串首次通知用户（后续重试静默，避免刷屏）
    const delay = schedulePersistRetry();
    if (!persistErrorNotified) {
      persistErrorNotified = true;
      broadcastPersistError('数据保存失败，请检查磁盘空间或权限，稍后会自动重试', true, delay);
    }
  }
}

/** 写操作后调用：标记脏数据并防抖落盘（拆分前为模块私有，现供各领域文件使用） */
export function saveDatabase(): void {
  markDirty();
}

export function forceSaveDatabase(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  persistToDisk();
}

export function getDatabase(): Database {
  if (testDb) {
    return testDb;
  }
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/** 供 schema.ts 的 initDatabase / closeDatabase 设置或清除连接（避免循环依赖） */
export function setDatabase(next: Database | null): void {
  db = next;
}

export function runTransaction<T>(fn: (db: Database) => T): T {
  const database = getDatabase();
  database.run('BEGIN TRANSACTION');
  try {
    const result = fn(database);
    database.run('COMMIT');
    saveDatabase();
    return result;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

export function runBatch(operations: Array<(db: Database) => void>): void {
  runTransaction((database) => {
    for (const op of operations) {
      op(database);
    }
  });
}

export function closeDatabase(): void {
  if (db) {
    forceSaveDatabase();
    db.close();
    setDatabase(null);
    logger.info('Database closed');
  }
}

// ============================================================================
// 测试辅助（仅测试环境使用）
// ============================================================================

export function injectTestDatabase(value: Database | null): void {
  testDb = value;
}

export function getTestDatabase(): Database | null {
  return testDb;
}

export function resetTestDatabaseState(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  isDirty = false;
  retryDelay = SAVE_DELAY;
  persistErrorNotified = false;
  testDb = null;
}
