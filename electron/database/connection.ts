/**
 * database/connection — 连接生命周期与事务原语
 * 从原 database.ts（2400+ 行）拆分而来，逻辑保持不变。
 *
 * 职责：sql.js 连接单例、防抖落盘、事务、测试注入。
 * schema/建表/迁移见 schema.ts；各领域 db 对象见同目录其他文件。
 */
import { Database } from 'sql.js';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger';

let db: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;
let isDirty = false;
let testDb: Database | null = null;
const SAVE_DELAY = 3000;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'zhixing.db');
}

function markDirty(): void {
  isDirty = true;
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
    logger.debug('Database saved to disk');
  } catch (error) {
    logger.error('Failed to save database', { error: String(error) });
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
  isDirty = false;
  testDb = null;
}
