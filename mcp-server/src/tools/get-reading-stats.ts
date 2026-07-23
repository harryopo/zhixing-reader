import { queryScalar } from '../db.js';
import type { ReadingStats } from '../types.js';

/**
 * zhixing_get_reading_stats Tool 实现。
 *
 * 聚合查询阅读统计：书籍/划线/笔记/卡片/生词/阅读时长。
 * 多个 COUNT/SUM 查询合并返回，供 LLM 一次性了解用户阅读全景。
 */

export interface GetReadingStatsInput {
  // 无参数
}

/**
 * 执行阅读统计聚合查询。
 *
 * 涉及表：
 * - books（书架总数）
 * - highlights（划线 + 笔记数）
 * - cards（知识卡片 + 待复习数）
 * - vocabulary（生词数）
 * - daily_stats（阅读时长，reading_time 单位为分钟）
 */
export async function getReadingStats(): Promise<ReadingStats> {
  // 书籍总数
  const totalBooks = queryScalar<number>('SELECT COUNT(*) FROM books');

  // 划线总数
  const totalHighlights = queryScalar<number>('SELECT COUNT(*) FROM highlights');

  // 笔记总数（note 非空且非空字符串）
  const totalNotes = queryScalar<number>(
    `SELECT COUNT(*) FROM highlights WHERE note IS NOT NULL AND note != ''`,
  );

  // 知识卡片总数
  const totalCards = queryScalar<number>('SELECT COUNT(*) FROM cards');

  // 生词总数
  const totalVocabulary = queryScalar<number>('SELECT COUNT(*) FROM vocabulary');

  // 待复习卡片数（due <= 当前时间）
  const dueCardsCount = queryScalar<number>(
    `SELECT COUNT(*) FROM cards WHERE datetime(due) <= datetime('now')`,
  );

  // 累计阅读时长（分钟）
  const totalReadingTimeMinutes = queryScalar<number>(
    `SELECT COALESCE(SUM(reading_time), 0) FROM daily_stats`,
  );

  // 最近 7 天阅读时长（分钟）
  // daily_stats.date 为 'YYYY-MM-DD' 格式，用 date() 比较
  const last7DaysReadingMinutes = queryScalar<number>(
    `SELECT COALESCE(SUM(reading_time), 0) FROM daily_stats
     WHERE date(date) >= date('now', '-7 days')`,
  );

  return {
    totalBooks,
    totalHighlights,
    totalNotes,
    totalCards,
    totalVocabulary,
    dueCardsCount,
    totalReadingTimeMinutes,
    last7DaysReadingMinutes,
  };
}
