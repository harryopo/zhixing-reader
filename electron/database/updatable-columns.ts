/**
 * database/updatable-columns — 拼进 SQL 的列名判据
 *
 * 值一律走 `?` 占位符，这一条项目早就做到了；但 `SET x = ?` 里的 **x** 只能是标识符，
 * 占位符管不到它。四个 `update(id, record)` 的 record 来自渲染层（BOOKS / HIGHLIGHTS /
 * METHODOLOGIES / KNOWLEDGE_CARDS 四条 UPDATE 通道整包下发），键名原样拼进去就等于
 * 让调用方决定 SQL 的形状：`{ 'content = 1, note': 'x' }` 会改写成
 * `SET content = 1, note = ?`。
 *
 * 判据只用一个来源：库自己（`PRAGMA table_info`）。**不在此另写一份列清单** ——
 * 手写清单与本项目的老毛病同源（加一列要记得改清单，忘了就是"这个字段存不进去"）。
 * 也不做缓存：sql.js 的库在测试里会整体换掉，按表名缓存会拿到上一份库的列。
 */
import { getDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

/** SQLite 里不需要加引号就能用的裸标识符 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 逐个核对列名，全部命中才放行；返回传入的列名（便于内联在 map/filter 之后）。
 * 任何不合法的键都**在建 SQL 之前**抛错，所以不会出现"一半写进去、一半报错"。
 */
export function assertRealColumns(table: string, columns: string[]): string[] {
  if (columns.length === 0) return columns;
  if (!IDENTIFIER.test(table)) throw new Error(`非法的表名：${table}`);

  const cols = new Set(
    rowsToObjects(getDatabase().exec(`PRAGMA table_info(${table})`)).map((c) => c.name as string)
  );
  if (cols.size === 0) throw new Error(`表 ${table} 不存在，无法校验列名`);

  const offenders = columns.filter((c) => !IDENTIFIER.test(c) || !cols.has(c));
  if (offenders.length > 0) {
    throw new Error(`${table} 表没有这些列，拒绝拼进 SQL：${offenders.join(', ')}`);
  }
  return columns;
}
