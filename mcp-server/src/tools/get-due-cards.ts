import { z } from 'zod';
import { query } from '../db.js';
import type { DueCardItem } from '../types.js';

/**
 * zhixing_get_due_cards Tool 实现。
 *
 * 获取已到期待复习的知识卡片（FSRS v5 调度）。
 * 按 due 时间升序排列，优先返回最该复习的卡片。
 */

export const GetDueCardsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('返回卡片数量上限，1-100，默认 20'),
}).strict();

export type GetDueCardsInput = z.infer<typeof GetDueCardsInputSchema>;

/**
 * 执行待复习卡片查询。
 *
 * 三表 JOIN：
 * - cards（FSRS 调度信息）
 * - highlights（划线内容，作为卡片复习对象）
 * - books（书名，用于展示上下文）
 *
 * due 字段为 ISO 字符串，与 datetime('now') 比较。
 */
export async function getDueCards(params: GetDueCardsInput): Promise<DueCardItem[]> {
  const sql = `
    SELECT
      c.id AS card_id,
      c.highlight_id,
      b.title AS book_title,
      h.content AS highlight_content,
      c.state,
      c.stability,
      c.difficulty,
      c.due,
      c.reps,
      c.lapses,
      c.application_tag,
      c.mastery_level
    FROM cards c
    JOIN highlights h ON c.highlight_id = h.id
    JOIN books b ON h.book_id = b.id
    WHERE datetime(c.due) <= datetime('now')
    ORDER BY c.due ASC
    LIMIT ?
  `;

  const rows = query(sql, [params.limit]);

  return rows.map((row): DueCardItem => ({
    cardId: String(row.card_id),
    highlightId: String(row.highlight_id),
    bookTitle: String(row.book_title),
    highlightContent: String(row.highlight_content),
    state: Number(row.state ?? 0),
    stability: Number(row.stability ?? 0),
    difficulty: Number(row.difficulty ?? 0),
    due: String(row.due),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    applicationTag: row.application_tag == null ? null : String(row.application_tag),
    masteryLevel: Number(row.mastery_level ?? 0),
  }));
}
