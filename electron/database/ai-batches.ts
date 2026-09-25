/**
 * database/ai-batches — AI 生成批次台账（ai_generation_batches）
 *
 * 记的是「这一批喂进去了哪些划线」，不是「模型引用了哪些划线」：
 * 每张卡片只标 1 条来源、每条方法论最多标 3 条，拿它们当进度会把大量
 * 已处理的划线当成没处理，下次再喂一遍（重复生成 + 重复花钱）。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection'
import { logger } from '../logger'
import type { AiCoverageTask } from '../../src/shared/ai-coverage'

function parseIdList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : []
  } catch {
    logger.warn(`ai_generation_batches.highlight_ids 不是合法 JSON，按空批次处理: ${raw.slice(0, 40)}`)
    return []
  }
}

export const aiBatchesDb = {
  /** 记一批。空批不记（没有东西被处理过，也不该在进度里占一格） */
  record(bookId: string, feature: AiCoverageTask, highlightIds: readonly string[]): void {
    if (highlightIds.length === 0) return
    const id = `aib_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    getDatabase().run(
      'INSERT INTO ai_generation_batches (id, book_id, feature, highlight_ids) VALUES (?, ?, ?, ?)',
      [id, bookId, feature, JSON.stringify([...highlightIds])],
    )
    saveDatabase()
  },

  /** 这本书在这个功能下已经喂过的划线 id（跨批次取并集） */
  getProcessedIds(bookId: string, feature: AiCoverageTask): string[] {
    const result = getDatabase().exec(
      'SELECT highlight_ids FROM ai_generation_batches WHERE book_id = ? AND feature = ?',
      [bookId, feature],
    )
    if (result.length === 0) return []
    const ids = new Set<string>()
    for (const [raw] of result[0].values) {
      for (const id of parseIdList(String(raw))) ids.add(id)
    }
    return [...ids]
  },

  /** 每本书已处理的条数（列表页进度一次取全，不按书逐个查） */
  getProcessedCounts(feature: AiCoverageTask): Record<string, number> {
    const result = getDatabase().exec(
      'SELECT book_id, highlight_ids FROM ai_generation_batches WHERE feature = ?',
      [feature],
    )
    const perBook = new Map<string, Set<string>>()
    if (result.length > 0) {
      for (const [bookId, raw] of result[0].values) {
        const key = String(bookId)
        const set = perBook.get(key) ?? new Set<string>()
        for (const id of parseIdList(String(raw))) set.add(id)
        perBook.set(key, set)
      }
    }
    const counts: Record<string, number> = {}
    for (const [bookId, set] of perBook) {
      // 只剩坏行的书不进清单：读侧一律 `?? 0`，列出来反而是"这本有进度"的假信号
      if (set.size > 0) counts[bookId] = set.size
    }
    return counts
  },

  /** 「重新生成」= 清空重来，进度也要一起归零，否则下一批会以为前面处理过了 */
  clear(bookId: string, feature: AiCoverageTask): number {
    const before = getDatabase().exec(
      'SELECT COUNT(*) FROM ai_generation_batches WHERE book_id = ? AND feature = ?',
      [bookId, feature],
    )
    const count = before.length > 0 ? Number(before[0].values[0][0]) || 0 : 0
    if (count === 0) return 0
    runTransaction((database) => {
      database.run(
        'DELETE FROM ai_generation_batches WHERE book_id = ? AND feature = ?',
        [bookId, feature],
      )
    })
    return count
  },
}
