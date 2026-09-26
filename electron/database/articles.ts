/**
 * database/articles — 每日学习文章表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';

export const articlesDb = {
  getAll(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM articles ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM articles WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },



  create(article: {
    id: string;
    title_en: string;
    title_zh?: string;
    content_en: string;
    content_zh?: string;
    summary_zh?: string;
    source: string;
    source_url?: string;
    source_website?: string;
    category?: string;
    difficulty?: string;
    vocabulary_json?: string;
    published_at?: string;
  }): boolean {
    try {
      getDatabase().run(
        `INSERT INTO articles (id, title_en, title_zh, content_en, content_zh, summary_zh, source, source_url, source_website, category, difficulty, vocabulary_json, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          article.id,
          article.title_en,
          article.title_zh ?? null,
          article.content_en,
          article.content_zh ?? null,
          article.summary_zh ?? null,
          article.source,
          article.source_url ?? null,
          article.source_website ?? null,
          article.category ?? 'psychology',
          article.difficulty ?? 'cet4',
          article.vocabulary_json ?? null,
          article.published_at ?? null,
        ]
      );
      saveDatabase();
      return true;
    } catch (error) {
      logger.error('Failed to create article', { error: String(error) });
      return false;
    }
  },

  markAsRead(id: string): void {
    getDatabase().run('UPDATE articles SET is_read = 1 WHERE id = ?', [id]);
    saveDatabase();
  },

  toggleFavorite(id: string): boolean {
    const article = this.getById(id);
    if (!article) return false;
    const newStatus = article.is_favorite ? 0 : 1;
    getDatabase().run('UPDATE articles SET is_favorite = ? WHERE id = ?', [newStatus, id]);
    saveDatabase();
    return newStatus === 1;
  },
};
