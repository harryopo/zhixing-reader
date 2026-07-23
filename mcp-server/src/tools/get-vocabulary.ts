import { z } from 'zod';
import { query, type SqlValue } from '../db.js';
import type { VocabularyItem } from '../types.js';

/**
 * zhixing_get_vocabulary Tool 实现。
 *
 * 获取生词本，默认只返回未掌握的单词。
 * 按复习次数升序、添加时间倒序排列，优先返回最该复习的词。
 */

export const GetVocabularyInputSchema = z.object({
  unmasteredOnly: z
    .boolean()
    .default(true)
    .describe('是否只返回未掌握的单词，默认 true。设为 false 返回全部'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('返回单词数量上限，1-200，默认 50'),
}).strict();

export type GetVocabularyInput = z.infer<typeof GetVocabularyInputSchema>;

/**
 * 执行生词本查询。
 *
 * SQLite 无原生 BOOLEAN，is_mastered 用 INTEGER 0/1 表示。
 * 读取时用 Boolean() 转换，null 安全处理旧数据。
 *
 * 排序逻辑：
 * - 未掌握优先：review_count ASC（复习次数少的先复习）
 * - 添加时间倒序：新词优先
 */
export async function getVocabulary(params: GetVocabularyInput): Promise<VocabularyItem[]> {
  let sql = `
    SELECT
      id,
      word,
      phonetic,
      part_of_speech,
      meaning_zh,
      example_en,
      example_zh,
      cefr_level,
      source,
      is_mastered,
      review_count,
      last_review_at,
      next_review_at,
      created_at
    FROM vocabulary
  `;
  const sqlParams: SqlValue[] = [];

  if (params.unmasteredOnly) {
    sql += ` WHERE is_mastered = 0`;
  }

  sql += ` ORDER BY review_count ASC, created_at DESC LIMIT ?`;
  sqlParams.push(params.limit);

  const rows = query(sql, sqlParams);

  return rows.map((row): VocabularyItem => ({
    id: String(row.id),
    word: String(row.word),
    phonetic: row.phonetic == null ? null : String(row.phonetic),
    partOfSpeech: row.part_of_speech == null ? null : String(row.part_of_speech),
    definition: String(row.meaning_zh),
    exampleEn: row.example_en == null ? null : String(row.example_en),
    exampleZh: row.example_zh == null ? null : String(row.example_zh),
    cefrLevel: row.cefr_level == null ? null : String(row.cefr_level),
    source: String(row.source ?? '手动添加'),
    isMastered: row.is_mastered != null ? Boolean(row.is_mastered) : false,
    reviewCount: Number(row.review_count ?? 0),
    lastReviewAt: row.last_review_at == null ? null : String(row.last_review_at),
    nextReviewAt: row.next_review_at == null ? null : String(row.next_review_at),
    addedAt: String(row.created_at),
  }));
}
