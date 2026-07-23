import initSqlJs, { type Database, type BindParams, type SqlValue } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * 数据库单例与查询辅助。
 *
 * 通过环境变量 ZHIXING_DB_PATH 指定数据库文件路径，
 * 默认指向 ~/.zhixing-reader/zhixing.db。
 *
 * 只读：本模块仅暴露 SELECT 查询接口，不提供任何写入能力。
 */

let dbInstance: Database | null = null;
let dbInitError: string | null = null;

/**
 * 获取数据库文件路径。
 * 优先使用 ZHIXING_DB_PATH 环境变量，否则使用默认路径。
 */
export function getDatabasePath(): string {
  const envPath = process.env.ZHIXING_DB_PATH;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.zhixing-reader', 'zhixing.db');
}

/**
 * 定位 sql.js wasm 文件路径。
 * 在 Node ESM 环境下，需要显式指定 wasm 文件位置。
 */
function locateWasmFile(): string {
  try {
    // 通过 require.resolve 找到 sql.js 包根目录
    const sqlJsEntry = require.resolve('sql.js');
    const sqlJsDir = path.dirname(sqlJsEntry);
    const wasmPath = path.join(sqlJsDir, 'sql-wasm.wasm');
    if (fs.existsSync(wasmPath)) {
      return wasmPath;
    }
  } catch {
    // 降级处理
  }
  // 降级：返回相对路径让 sql.js 自己处理
  return 'sql-wasm.wasm';
}

/**
 * 初始化数据库连接。
 * 幂等：多次调用返回同一实例。
 *
 * @throws Error 当数据库文件不存在或加载失败时抛出友好错误
 */
export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (dbInitError) {
    throw new Error(dbInitError);
  }

  const dbPath = getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    dbInitError = `数据库未找到：${dbPath}。请先启动知行读书应用初始化数据库。`;
    throw new Error(dbInitError);
  }

  try {
    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        if (file === 'sql-wasm.wasm') {
          return locateWasmFile();
        }
        return file;
      },
    });

    const fileBuffer = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(fileBuffer);
    return dbInstance;
  } catch (error) {
    dbInitError = `数据库加载失败：${error instanceof Error ? error.message : String(error)}`;
    throw new Error(dbInitError);
  }
}

/**
 * 获取已初始化的数据库实例。
 * 必须先调用 initDatabase()。
 */
export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error('数据库未初始化。请先调用 initDatabase()。');
  }
  return dbInstance;
}

/**
 * 执行 SELECT 查询，返回对象数组。
 * 将 sql.js 的 { columns, values } 结构转换为 [{ col: val, ... }]。
 *
 * @param sql SQL 查询语句（仅支持 SELECT，不应用于写操作）
 * @param params 绑定参数（SqlValue 数组）
 * @returns 查询结果对象数组
 */
export function query(sql: string, params: BindParams = []): Record<string, unknown>[] {
  const db = getDatabase();
  const result = db.exec(sql, params);
  if (!result || result.length === 0) return [];

  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/**
 * 执行聚合查询，返回单个标量值。
 * 适用于 COUNT / SUM / MAX 等单值查询。
 *
 * @param sql SQL 查询语句
 * @param params 绑定参数
 * @returns 第一个字段的值，无结果时返回 0
 */
export function queryScalar<T = number>(sql: string, params: BindParams = []): T {
  const rows = query(sql, params);
  if (rows.length === 0) return 0 as unknown as T;
  const firstCol = Object.values(rows[0])[0];
  return (firstCol ?? 0) as unknown as T;
}

/** 重新导出 SqlValue 类型，供 tool 实现文件使用 */
export type { SqlValue };

/**
 * 从内存 Buffer 初始化数据库连接。
 * 用于测试场景，或未来需要从非文件来源加载的场景。
 * 调用前应先调用 resetForTesting() 清理旧实例。
 *
 * @param buffer SQLite 数据库二进制内容
 */
export async function initDatabaseWithBuffer(buffer: Buffer | Uint8Array): Promise<Database> {
  if (dbInstance) {
    throw new Error('数据库已初始化。请先调用 resetForTesting() 清理状态。');
  }

  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (file === 'sql-wasm.wasm') {
        return locateWasmFile();
      }
      return file;
    },
  });

  dbInstance = new SQL.Database(buffer);
  return dbInstance;
}

/**
 * 关闭数据库连接。
 * 用于测试或进程退出时清理资源。
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // 忽略关闭错误
    }
    dbInstance = null;
    dbInitError = null;
  }
}

/**
 * 重置模块状态（仅供测试使用）。
 * 关闭现有连接并清除错误缓存，允许重新初始化。
 */
export function resetForTesting(): void {
  closeDatabase();
}
