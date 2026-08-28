/**
 * database/vocabulary — 生词本表操作（艾宾浩斯 + SM-2 混合复习算法）
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';
import { reviewVocabulary } from '../fsrs-engine';

export const vocabularyDb = {
  getAll(limit: number = 200): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM vocabulary WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },

  getByWord(word: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM vocabulary WHERE word = ?', [word.toLowerCase()]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },

  getUnmastered(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary WHERE is_mastered = 0 ORDER BY review_count ASC, created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  // 获取今日需要复习的单词（基于艾宾浩斯算法）
  getDueForReview(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT * FROM vocabulary
       WHERE is_mastered = 0
       AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))
       ORDER BY next_review_at ASC, created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rowsToObjects(result);
  },

  // 获取今日待复习数量
  getDueCount(): number {
    const result = getDatabase().exec(
      `SELECT COUNT(*) FROM vocabulary
       WHERE is_mastered = 0
       AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))`
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  create(vocab: {
    id?: string;
    word: string;
    phonetic?: string;
    part_of_speech?: string;
    meaning_zh: string;
    translation?: string;
    pos?: string;
    example_en?: string;
    example_zh?: string;
    cefr_level?: string;
    source_article_id?: string;
    source?: string;
  }): Record<string, unknown> | null {
    try {
      // 检查是否已存在
      const existing = this.getByWord(vocab.word);
      if (existing) return existing as Record<string, unknown>;

      const id = vocab.id || `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      getDatabase().run(
        `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, example_en, example_zh, cefr_level, source_article_id, source, next_review_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          vocab.word.toLowerCase(),
          vocab.phonetic ?? vocab.translation ?? null,
          vocab.part_of_speech ?? vocab.pos ?? null,
          vocab.meaning_zh || vocab.translation || '',
          vocab.example_en ?? null,
          vocab.example_zh ?? null,
          vocab.cefr_level ?? null,
          vocab.source_article_id ?? null,
          vocab.source ?? '手动添加',
          now, // 新单词立即可以复习
          now,
        ]
      );
      saveDatabase();
      return this.getById(id) || null;
    } catch (error) {
      logger.error('Failed to create vocabulary', { error: String(error) });
      return null;
    }
  },

  // 基于 FSRS 算法更新复习数据
  // quality: 1-4 评分（1=Again, 2=Hard, 3=Good, 4=Easy）
  updateReviewData(id: string, reviewData: {
    quality: number;
    efFactor?: number;
    intervalDays?: number;
    repetitionCount?: number;
    isMastered?: boolean;
  }): Record<string, unknown> | null {
    try {
      const vocab = this.getById(id);
      if (!vocab) return null;

      // Map quality 1-5 to Rating 1-4
      const ratingMap: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 };
      const fsrsRating = ratingMap[reviewData.quality] ?? 3;

      const result = reviewVocabulary(
        {
          efFactor: reviewData.efFactor ?? (vocab.ef_factor as number) ?? 2.5,
          intervalDays: reviewData.intervalDays ?? (vocab.interval_days as number) ?? 0,
          repetitionCount: reviewData.repetitionCount ?? (vocab.repetition_count as number) ?? 0,
          learningStage: (vocab.learning_stage as number) ?? 0,
          familiarityLevel: (vocab.familiarity_level as number) ?? 0,
        },
        fsrsRating
      );

      const isMastered = reviewData.isMastered ?? result.isMastered;

      getDatabase().run(
        `UPDATE vocabulary SET
          review_count = review_count + 1,
          last_review_at = datetime('now'),
          next_review_at = ?,
          ef_factor = ?,
          interval_days = ?,
          repetition_count = ?,
          is_mastered = ?,
          familiarity_level = ?,
          learning_stage = ?
         WHERE id = ?`,
        [
          result.nextReviewAt,
          result.efFactor,
          result.intervalDays,
          result.repetitionCount,
          isMastered ? 1 : 0,
          result.familiarityLevel,
          result.learningStage,
          id,
        ]
      );
      saveDatabase();
      return this.getById(id) || null;
    } catch (error) {
      logger.error('Failed to update review data', { error: String(error) });
      return null;
    }
  },

  markAsMastered(id: string): void {
    getDatabase().run('UPDATE vocabulary SET is_mastered = 1 WHERE id = ?', [id]);
    saveDatabase();
  },

  incrementReviewCount(id: string): void {
    getDatabase().run(
      "UPDATE vocabulary SET review_count = review_count + 1, last_review_at = datetime('now') WHERE id = ?",
      [id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM vocabulary WHERE id = ?', [id]);
    saveDatabase();
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM vocabulary');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  getMasteredCount(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM vocabulary WHERE is_mastered = 1');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  // 搜索单词
  search(keyword: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary WHERE word LIKE ? OR meaning_zh LIKE ? ORDER BY created_at DESC',
      [`%${keyword}%`, `%${keyword}%`]
    );
    return rowsToObjects(result);
  },
};
