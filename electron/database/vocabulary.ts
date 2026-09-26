/**
 * database/vocabulary — 生词本表操作（艾宾浩斯 + SM-2 混合复习算法）
 * 从原 database.ts 拆分而来。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';
import { reviewVocabulary } from '../fsrs-engine';
import { splitQueryTerms, toLikePattern } from '../../src/shared/global-search';

/** 与全局搜索同一条 LIKE 写法：值走占位符，通配符在 pattern 里已转义，ESCAPE 不能省 */
const LIKE = `LIKE ? ESCAPE '\\'`;

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

  /**
   * 基于 FSRS-6.0 更新复习数据。
   *
   * ⚠️ `quality` 是 **ts-fsrs 的 Rating（1=Again, 2=Hard, 3=Good, 4=Easy）**，
   * 与 `card.review(id, rating)` 完全同一口径，不做任何再映射。
   *
   * 2026-09-15 修复：此前这里有一张 `{1:1, 2:2, 3:3, 4:3, 5:4}` 的映射表，
   * 而两个生词本界面传的是 SM-2 风格的 1/3/4/5 —— 于是「困难」(3) 被静默映射成
   * Good(3)，「模糊」(3) 同理，ts-fsrs 的 **Hard 档在生词本里完全不可达**。
   * 结果是"想不起来的词"和"想得很顺的词"拿到完全一样的调度。
   * 现在两个界面直接传 FSRS Rating，映射表删除。
   */
  updateReviewData(id: string, reviewData: {
    /** ts-fsrs Rating：1=Again / 2=Hard / 3=Good / 4=Easy */
    quality: number;
    efFactor?: number;
    intervalDays?: number;
    repetitionCount?: number;
    isMastered?: boolean;
    stability?: number;
    difficulty?: number;
    lapses?: number;
  }): Record<string, unknown> | null {
    try {
      const vocab = this.getById(id);
      if (!vocab) return null;

      // 直接使用调用方给出的 FSRS Rating；越界值回退到 Good 并记日志，避免静默算错调度
      const raw = Number(reviewData.quality);
      if (!Number.isInteger(raw) || raw < 1 || raw > 4) {
        logger.warn('Invalid vocabulary rating, falling back to Good(3)', {
          id,
          quality: reviewData.quality,
        });
      }
      const fsrsRating = (Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : 3) as 1 | 2 | 3 | 4;

      const result = reviewVocabulary(
        {
          efFactor: reviewData.efFactor ?? (vocab.ef_factor as number) ?? 2.5,
          intervalDays: reviewData.intervalDays ?? (vocab.interval_days as number) ?? 0,
          repetitionCount: reviewData.repetitionCount ?? (vocab.repetition_count as number) ?? 0,
          learningStage: (vocab.learning_stage as number) ?? 0,
          familiarityLevel: (vocab.familiarity_level as number) ?? 0,
          // FSRS-6.0 记忆状态（旧数据为 0，会由引擎按学习路径自举）
          stability: reviewData.stability ?? (vocab.stability as number) ?? 0,
          difficulty: reviewData.difficulty ?? (vocab.difficulty as number) ?? 0,
          lapses: reviewData.lapses ?? (vocab.lapses as number) ?? 0,
        },
        fsrsRating
      );

      // is_mastered 是**用户显式**的"不再复习"开关（见 markAsMastered）。
      // 2026-09-15 起 reviewVocabulary 不再自动置位它 —— 否则一个词复习满 5 次就会被
      // 永久移出待复习队列，而 FSRS 明明已经把它的下次复习排到数百天之后，本该回来。
      const isMastered = reviewData.isMastered ?? false;

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
          learning_stage = ?,
          stability = ?,
          difficulty = ?,
          lapses = ?
         WHERE id = ?`,
        [
          result.nextReviewAt,
          result.efFactor,
          result.intervalDays,
          result.repetitionCount,
          isMastered ? 1 : 0,
          result.familiarityLevel,
          result.learningStage,
          result.stability,
          result.difficulty,
          result.lapses,
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

  /**
   * 把词排进复习队列：只把 next_review_at 提到「现在」，不记复习、不改调度参数。
   *
   * 与 updateReviewData 的区别就是这个按钮存在的意义：
   * 原来界面的「加入复习」调的是 updateReviewData(quality: Good)，
   * 等于替用户提交了一次「我认识」的评分（review_count + 1、last_review_at = now、间隔被重排）。
   */
  scheduleForReview(id: string): void {
    // 注意：vocabulary 表**没有** updated_at 列（只有 created_at），别照抄 highlights 的写法
    getDatabase().run('UPDATE vocabulary SET next_review_at = ? WHERE id = ?', [
      new Date().toISOString(),
      id,
    ]);
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

  /**
   * 生词本那台筛选器 —— 与全局搜索同一套语义：空格分词、词与词 AND、`%` `_` 按字面匹配。
   *
   * 分词与转义都取自 `src/shared/global-search.ts` 那一份：两边各写一遍就会漂
   * （原来这条 SQL 把整串当一个连续片段、又不转义，搜「ZQXW XHYZ」出 0 条，
   * 而搜索页说 1 条；搜 `%` 则命中所有行）。对账见 tests/search-filter-parity.test.ts。
   */
  search(keyword: string): Record<string, unknown>[] {
    const terms = splitQueryTerms(keyword);
    if (terms.length === 0) {
      return rowsToObjects(getDatabase().exec('SELECT * FROM vocabulary ORDER BY created_at DESC'));
    }
    const perTerm = `(word ${LIKE} OR meaning_zh ${LIKE})`;
    const where = terms.map(() => perTerm).join(' AND ');
    const params = terms.flatMap((term) => [toLikePattern(term), toLikePattern(term)]);
    return rowsToObjects(
      getDatabase().exec(
        `SELECT * FROM vocabulary WHERE ${where} ORDER BY created_at DESC`,
        params,
      ),
    );
  },
};
