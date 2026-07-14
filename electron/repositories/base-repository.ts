/**
 * 基础 Repository 抽象类
 * 提供通用的 CRUD 操作实现
 */

import { Database } from 'sql.js'
import { rowsToObjects } from '../utils/db'
import { logger } from '../logger'

export type DatabaseAccessor = () => Database

/**
 * 基础 Repository 抽象类
 * 封装通用的数据库操作，子类只需实现特定的查询逻辑
 */
export abstract class BaseRepository<T extends { id: string }> {
  constructor(protected getDb: DatabaseAccessor) {}

  /**
   * 执行查询并返回结果数组
   */
  protected query(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    try {
      const result = this.getDb().exec(sql, params)
      return rowsToObjects(result)
    } catch (error) {
      logger.error(`Query failed: ${sql}`, { error: String(error), params })
      throw error
    }
  }

  /**
   * 执行查询并返回第一个结果
   */
  protected queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
    const rows = this.query(sql, params)
    return rows.length > 0 ? rows[0] : null
  }

  /**
   * 执行查询并返回标量值
   */
  protected queryScalar(sql: string, params: unknown[] = []): number {
    const result = this.getDb().exec(sql, params)
    return result.length > 0 ? (result[0].values[0][0] as number) : 0
  }

  /**
   * 执行写操作（INSERT, UPDATE, DELETE）
   */
  protected execute(sql: string, params: unknown[] = []): void {
    try {
      this.getDb().run(sql, params)
    } catch (error) {
      logger.error(`Execute failed: ${sql}`, { error: String(error), params })
      throw error
    }
  }

  /**
   * 执行事务
   */
  protected transaction<R>(fn: (db: Database) => R): R {
    const db = this.getDb()
    db.run('BEGIN TRANSACTION')
    try {
      const result = fn(db)
      db.run('COMMIT')
      return result
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  }

  /**
   * 生成唯一 ID
   */
  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * 将数据库行映射为实体对象
   * 子类需要实现此方法
   */
  protected abstract mapToEntity(row: Record<string, unknown>): T

  /**
   * 将实体对象映射为数据库行
   * 子类需要实现此方法
   */
  protected abstract mapToRow(entity: Partial<T>): Record<string, unknown>

  /**
   * 获取表名
   * 子类需要实现此方法
   */
  protected abstract getTableName(): string

  /**
   * 根据 ID 查找实体
   */
  findById(id: string): T | null {
    const row = this.queryOne(`SELECT * FROM ${this.getTableName()} WHERE id = ?`, [id])
    return row ? this.mapToEntity(row) : null
  }

  /**
   * 查找所有实体
   */
  findAll(): T[] {
    const rows = this.query(`SELECT * FROM ${this.getTableName()} ORDER BY created_at DESC`)
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 创建实体
   */
  create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): T {
    const id = this.generateId()
    const now = new Date().toISOString()
    const fullEntity = { ...entity, id, createdAt: now, updatedAt: now } as unknown as T
    const row = this.mapToRow(fullEntity)

    const columns = Object.keys(row).join(', ')
    const placeholders = Object.keys(row).map(() => '?').join(', ')
    const values = Object.values(row)

    this.execute(
      `INSERT INTO ${this.getTableName()} (${columns}) VALUES (${placeholders})`,
      values
    )

    return fullEntity
  }

  /**
   * 更新实体
   */
  update(id: string, updates: Partial<T>): void {
    const row = this.mapToRow(updates)
    const now = new Date().toISOString()

    // 移除 id 和 createdAt 字段，添加 updatedAt
    const { id: _, createdAt: __, ...updateFields } = row
    updateFields.updated_at = now

    const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ')
    const values = [...Object.values(updateFields), id]

    this.execute(
      `UPDATE ${this.getTableName()} SET ${setClauses} WHERE id = ?`,
      values
    )
  }

  /**
   * 删除实体
   */
  delete(id: string): void {
    this.execute(`DELETE FROM ${this.getTableName()} WHERE id = ?`, [id])
  }

  /**
   * 批量删除实体
   */
  deleteBatch(ids: string[]): void {
    if (ids.length === 0) return

    this.transaction((db) => {
      const placeholders = ids.map(() => '?').join(', ')
      db.run(`DELETE FROM ${this.getTableName()} WHERE id IN (${placeholders})`, ids)
    })
  }

  /**
   * 统计实体数量
   */
  count(): number {
    return this.queryScalar(`SELECT COUNT(*) FROM ${this.getTableName()}`)
  }
}
