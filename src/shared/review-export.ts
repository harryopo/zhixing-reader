/**
 * 复习记录导出 —— 列清单与取数共用同一份 spec。
 *
 * 2026-09-20：这里原先读的是 cardId / quality / easeFactor / interval / reviewedAt，
 * 而 reviews 表的真实列是 card_id / rating / elapsed_days / scheduled_days / review_time
 * （sql.js 直接给列名，不做驼峰转换）。于是导出的 CSV 只有第一列有值，其余五列常年空白。
 * 现在表头和取值都从 REVIEW_CSV_COLUMNS 生成，测试拿真实 schema 逐列对账。
 */
import { csvEscape } from './csv'

export interface ReviewCsvColumn {
  /** CSV 表头（面向人/分析脚本） */
  header: string
  /** reviews 表的真实列名（面向数据） */
  key: string
}

export const REVIEW_CSV_COLUMNS: ReviewCsvColumn[] = [
  { header: 'review_id', key: 'id' },
  { header: 'card_id', key: 'card_id' },
  { header: 'rating', key: 'rating' },
  { header: 'elapsed_days', key: 'elapsed_days' },
  { header: 'scheduled_days', key: 'scheduled_days' },
  { header: 'review_time', key: 'review_time' },
]

/** 行数据来自 reviewsDb.getRecent()，形状就是 reviews 表的列 */
export function buildReviewCsv(rows: Array<Record<string, unknown>>): string {
  const lines = [REVIEW_CSV_COLUMNS.map((c) => c.header).join(',')]
  for (const row of rows) {
    lines.push(REVIEW_CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(','))
  }
  return lines.join('\n')
}
