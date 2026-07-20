/**
 * 卡片 Repository 实现
 * 封装复习卡片表的数据访问逻辑
 */

import { BaseRepository, DatabaseAccessor } from './base-repository'
import { Card } from '../types/entities'
import { ICardRepository } from '../types/repositories'
import { createCard, cardFromDb as _cardFromDb, cardToRow, CardState } from '../fsrs-engine'

export class SqlCardRepository extends BaseRepository<Card> implements ICardRepository {
  constructor(getDb: DatabaseAccessor) {
    super(getDb)
  }

  protected getTableName(): string {
    return 'cards'
  }

  protected mapToEntity(row: Record<string, unknown>): Card {
    return {
      id: row.id as string,
      highlightId: row.highlight_id as string,
      state: (row.state as number) ?? 0,
      step: (row.step as number) ?? 0,
      stability: (row.stability as number) ?? 0,
      difficulty: (row.difficulty as number) ?? 0,
      due: row.due as string,
      lastReview: (row.last_review as string) ?? null,
      elapsedDays: (row.elapsed_days as number) ?? 0,
      scheduledDays: (row.scheduled_days as number) ?? 0,
      reps: (row.reps as number) ?? 0,
      lapses: (row.lapses as number) ?? 0,
      applicationTag: row.application_tag as string | undefined,
      masteryLevel: row.mastery_level as number | undefined,
      createdAt: row.created_at as string | undefined,
    }
  }

  protected mapToRow(entity: Partial<Card>): Record<string, unknown> {
    const row: Record<string, unknown> = {}

    if (entity.id !== undefined) row.id = entity.id
    if (entity.highlightId !== undefined) row.highlight_id = entity.highlightId
    if (entity.state !== undefined) row.state = entity.state
    if (entity.step !== undefined) row.step = entity.step
    if (entity.stability !== undefined) row.stability = entity.stability
    if (entity.difficulty !== undefined) row.difficulty = entity.difficulty
    if (entity.due !== undefined) row.due = entity.due
    if (entity.lastReview !== undefined) row.last_review = entity.lastReview
    if (entity.elapsedDays !== undefined) row.elapsed_days = entity.elapsedDays
    if (entity.scheduledDays !== undefined) row.scheduled_days = entity.scheduledDays
    if (entity.reps !== undefined) row.reps = entity.reps
    if (entity.lapses !== undefined) row.lapses = entity.lapses
    if (entity.applicationTag !== undefined) row.application_tag = entity.applicationTag
    if (entity.masteryLevel !== undefined) row.mastery_level = entity.masteryLevel
    if (entity.createdAt !== undefined) row.created_at = entity.createdAt

    return row
  }

  /**
   * 根据高亮 ID 查找卡片
   */
  findByHighlightId(highlightId: string): Card | null {
    const row = this.queryOne(
      'SELECT * FROM cards WHERE highlight_id = ?',
      [highlightId]
    )
    return row ? this.mapToEntity(row) : null
  }

  /**
   * 根据书籍 ID 查找卡片
   */
  findByBookId(bookId: string): Card[] {
    const rows = this.query(
      `SELECT c.* FROM cards c
       JOIN highlights h ON c.highlight_id = h.id
       WHERE h.book_id = ?`,
      [bookId]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找到期的卡片
   */
  findDueCards(limit: number = 20): Card[] {
    const now = new Date().toISOString()
    const rows = this.query(
      'SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?',
      [now, limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 根据状态查找卡片
   */
  findByState(state: number, limit?: number): Card[] {
    let sql = 'SELECT * FROM cards WHERE state = ? ORDER BY due ASC'
    const params: unknown[] = [state]

    if (limit) {
      sql += ' LIMIT ?'
      params.push(limit)
    }

    const rows = this.query(sql, params)
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 查找新卡片
   */
  findNewCards(limit: number = 20): Card[] {
    return this.findByState(CardState.New, limit)
  }

  /**
   * 查找学习中的卡片
   */
  findLearningCards(limit: number = 20): Card[] {
    const rows = this.query(
      'SELECT * FROM cards WHERE state = 1 OR state = 3 ORDER BY due ASC LIMIT ?',
      [limit]
    )
    return rows.map(row => this.mapToEntity(row))
  }

  /**
   * 批量创建卡片
   */
  createBatch(highlightIds: string[]): Card[] {
    const cards: Card[] = []

    this.transaction((db) => {
      const stmt = db.prepare(
        `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const highlightId of highlightIds) {
        const card = createCard(highlightId)
        const row = cardToRow(card)
        stmt.run([
          row.id,
          row.highlight_id,
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
        ])
        cards.push(card)
      }

      stmt.free()
    })

    return cards
  }

  /**
   * 批量更新卡片
   */
  updateBatch(cards: Card[]): void {
    this.transaction((db) => {
      const stmt = db.prepare(
        `UPDATE cards SET state = ?, step = ?, stability = ?, difficulty = ?,
         due = ?, last_review = ?, elapsed_days = ?, scheduled_days = ?,
         reps = ?, lapses = ? WHERE id = ?`
      )

      for (const card of cards) {
        const row = cardToRow(card)
        stmt.run([
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
          row.id,
        ])
      }

      stmt.free()
    })
  }

  /**
   * 根据高亮 ID 删除卡片
   */
  deleteByHighlightId(highlightId: string): void {
    this.execute('DELETE FROM cards WHERE highlight_id = ?', [highlightId])
  }

  /**
   * 为已存在的高亮创建卡片
   */
  createForExistingHighlights(): { created: number; skipped: number } {
    const rows = this.query(`
      SELECT h.id FROM highlights h
      LEFT JOIN cards c ON h.id = c.highlight_id
      WHERE c.id IS NULL
    `)
    const highlightIds = rows.map(r => r.id as string)

    if (highlightIds.length === 0) {
      return { created: 0, skipped: 0 }
    }

    const cards = this.createBatch(highlightIds)
    return { created: cards.length, skipped: rows.length - cards.length }
  }

  /**
   * 获取复习统计
   */
  getReviewStats(): { total: number; due: number; new: number; learning: number; review: number } {
    const total = this.queryScalar('SELECT COUNT(*) FROM cards')
    const due = this.queryScalar("SELECT COUNT(*) FROM cards WHERE due <= datetime('now')")
    const newCards = this.queryScalar('SELECT COUNT(*) FROM cards WHERE state = 0')
    const learning = this.queryScalar('SELECT COUNT(*) FROM cards WHERE state = 1 OR state = 3')
    const review = this.queryScalar('SELECT COUNT(*) FROM cards WHERE state = 2')

    return { total, due, new: newCards, learning, review }
  }

  /**
   * 更新应用标签
   */
  updateApplicationTag(id: string, tag: string): void {
    this.execute('UPDATE cards SET application_tag = ? WHERE id = ?', [tag, id])
  }

  /**
   * 更新掌握度
   */
  updateMasteryLevel(id: string, level: number): void {
    this.execute('UPDATE cards SET mastery_level = ? WHERE id = ?', [level, id])
  }
}
