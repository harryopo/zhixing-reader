import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import initSqlJs, { Database } from 'sql.js'
import {
  setDatabase,
  getDatabase,
  getDatabasePath,
  forceSaveDatabase,
  exportDatabaseForPersist,
} from '../electron/database/connection'
import {
  applySchemaAndMigrations,
  resetTestDatabaseState,
  booksDb,
  highlightsDb,
  cardsDb,
} from '../electron/database'

/**
 * 外键开关在落盘之后还得是开着的 —— 这条守卫是 2026-09-24 一次真机实测换来的。
 *
 * 现象：界面上删一本书、删一条划线，schema 里明明写了 `ON DELETE CASCADE`，
 * 子表行却原样留在库里（复习卡片变成没人看得见的孤儿行）。
 * 根因不在 schema，也不在删除语句：**sql.js 的 `export()` 会把这条连接上的
 * `PRAGMA foreign_keys` 复位成 0**，而 `saveDatabase()` 之后 3 秒的防抖落盘每次都要
 * export 一遍 —— 于是启动时开好的外键，在第一次落盘之后就悄悄关了。
 *
 * 为什么现有测试抓不到：它们全走 `injectTestDatabase`，而落盘函数开头是
 * `if (!db || !isDirty) return`（模块级的 `db` 在测试里一直是 null）——
 * 也就是说**测试从来没真的执行过一次 export()**。所以这一组用例故意绕开那个注入通道，
 * 用 `setDatabase` 造一条和生产同形态的连接，把落盘走完整。
 */

const PROFILE = 'user-data-fk-export'
process.env.ZHIXING_TEST_PROFILE = PROFILE

function fkState(database: Database): number {
  const rows = database.exec('PRAGMA foreign_keys')
  return rows.length ? Number(rows[0].values[0][0]) : -1
}

function countOf(table: string, where: string, params: unknown[] = []): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params as never[])
  return rows.length ? Number(rows[0].values[0][0]) : -1
}

async function productionShapeConnection(): Promise<Database> {
  const SQL = await initSqlJs()
  mkdirSync(join(process.cwd(), '.test-tmp', PROFILE), { recursive: true })
  const db = new SQL.Database()
  setDatabase(db)
  applySchemaAndMigrations()
  return db
}

/** 一本书 + 一条划线 + 它生成的复习卡片 */
function seedChain(bookId: string, highlightId: string): string {
  booksDb.create({ id: bookId, title: '级联探针书' })
  highlightsDb.create({ id: highlightId, book_id: bookId, content: '级联探针划线', note: '' })
  return cardsDb.create(highlightId).id
}

afterEach(() => {
  setDatabase(null)
  resetTestDatabaseState()
})

describe('落盘之后外键仍然是开的', () => {
  it('反证：裸 export() 确实会把 foreign_keys 关掉（这个坑是真的，不是猜的）', async () => {
    const db = await productionShapeConnection()
    expect(fkState(db)).toBe(1)
    db.export()
    expect(fkState(db)).toBe(0)
  })

  it('exportDatabaseForPersist 交出去的还是同一份数据', async () => {
    const db = await productionShapeConnection()
    seedChain('b1', 'h1')
    const bytes = exportDatabaseForPersist(db)
    const SQL = await initSqlJs()
    const reopened = new SQL.Database(bytes)
    const rows = reopened.exec('SELECT COUNT(*) FROM highlights')
    expect(rows.length ? Number(rows[0].values[0][0]) : -1).toBe(1)
  })

  it('走完真实落盘（forceSaveDatabase）之后：删一本书，划线与复习卡片一起消失', async () => {
    const db = await productionShapeConnection()
    const cardId = seedChain('b1', 'h1')
    expect(fkState(db)).toBe(1)

    forceSaveDatabase()
    // 落盘写到了测试专属目录，且写的确实是这条连接的内容
    expect(readFileSync(getDatabasePath()).length).toBeGreaterThan(0)
    expect(fkState(db)).toBe(1)

    booksDb.delete('b1')
    expect(countOf('highlights', "id = 'h1'")).toBe(0)
    expect(countOf('cards', 'id = ?', [cardId])).toBe(0)
  })

  it('删一条划线同样带走它的复习卡片（撤销那套的现场依赖这件事）', async () => {
    await productionShapeConnection()
    const cardId = seedChain('b1', 'h1')
    forceSaveDatabase()

    highlightsDb.delete('h1')
    expect(countOf('cards', 'id = ?', [cardId])).toBe(0)
  })

  it('落盘路径只许走 exportDatabaseForPersist：裸 .export() 不许回来', () => {
    const source = readFileSync('electron/database/connection.ts', 'utf8')
    expect(source).toContain('const data = exportDatabaseForPersist(db);')
    expect(source).not.toMatch(/\bdb\.export\(\)/)
  })
})
