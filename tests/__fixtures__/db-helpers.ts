import initSqlJs, { Database } from 'sql.js'
import { injectTestDatabase, resetTestDatabaseState, applySchemaAndMigrations } from '../../electron/database'

/**
 * 测试数据库 fixture。
 *
 * ⚠️ 2026-09-15 重构：这里**曾经**是一份从 electron/database/schema.ts 复制粘贴出来的
 * 平行 schema（约 280 行 DDL）。它没有任何同步机制，于是每次生产侧加列，测试侧都不知道，
 * 集成测试就以 "no such column" 失败 —— 而报错常被当时那套数据访问层的 try/catch 吞成 `return null`，
 * 只看断言信息极难定位。2026-08-28 与 2026-09-15 各踩了一次。
 *
 * 现在改为直接复用生产的 `applySchemaAndMigrations()`：schema 只有一份真值，
 * 测试环境也顺带覆盖了真实的建表与幂等迁移路径。
 */

export async function createTestDatabase(): Promise<Database> {
  const SQL = await initSqlJs()
  return new SQL.Database()
}

/**
 * 在给定的测试连接上建表 + 跑迁移。
 * 必须先 `injectTestDatabase(db)` 后再调用 —— `applySchemaAndMigrations()` 通过
 * `getDatabase()` 取连接，注入后它才会指向这个内存库。
 */
export function runSchema(_db: Database): void {
  applySchemaAndMigrations()
}
export async function setupTestDatabase(): Promise<Database> {
  const testDb = await createTestDatabase()
  // 顺序很关键：先注入连接，applySchemaAndMigrations 才能拿到这个库
  injectTestDatabase(testDb)
  runSchema(testDb)
  return testDb
}

export function teardownTestDatabase(): void {
  resetTestDatabaseState()
}
