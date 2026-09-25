/**
 * database/highlights — 划线表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 * 依赖 cards：批量导入划线时自动创建 FSRS 复习卡片（原行为保留）。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';
import { cardsDb } from './cards';
import { UNGROUPED_CHAPTER } from '../../src/shared/chapter-summaries';
import { assertRealColumns } from './updatable-columns';

/**
 * 进程内的写计数器：每次增删改都 +1。
 *
 * 为什么签名不能只看「条数 + MAX(updated_at)」：
 * updated_at 精度只到秒，**同一秒内**的插入与更新（例如导入划线后立刻回填章节名）
 * 会让签名完全相同 —— 检索索引就不会重建，用户会看到"新导入的划线搜不到"。
 * 计数器由本模块的写方法维护，进程重启后归零（索引缓存那时也一起重建了，无需持久化）。
 */
let writeRevision = 0;

export const highlightsDb = {
  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT h.*, b.title as book_title FROM highlights h JOIN books b ON h.book_id = b.id WHERE h.book_id = ? ORDER BY h.created_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM highlights WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  /** 每本书的划线条数（AI 生成进度按书显示，一次查询取全，不逐本查） */
  getCountsByBook(): Record<string, number> {
    const result = getDatabase().exec('SELECT book_id, COUNT(*) FROM highlights GROUP BY book_id');
    const counts: Record<string, number> = {};
    if (result.length > 0) {
      for (const [bookId, count] of result[0].values) counts[String(bookId)] = Number(count);
    }
    return counts;
  },

  exists(bookId: string, content: string): boolean {
    const result = getDatabase().exec(
      'SELECT 1 FROM highlights WHERE book_id = ? AND content = ? LIMIT 1',
      [bookId, content]
    );
    return result.length > 0 && result[0].values.length > 0;
  },

  create(highlight: Record<string, unknown>): boolean {
    writeRevision++;
    const bookId = highlight.book_id as string;
    const content = highlight.content as string;

    if (this.exists(bookId, content)) {
      return false;
    }

    getDatabase().run(
      `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        highlight.id,
        bookId,
        highlight.chapter_title ?? null,
        content,
        highlight.note ?? null,
        highlight.style ?? 0,
        highlight.range_start ?? null,
        highlight.range_end ?? null,
      ]
    );
    saveDatabase();
    return true;
  },

  createBatch(highlights: Array<Record<string, unknown>>): number {
    writeRevision++;
    let newCount = 0;
    const newHighlightIds: string[] = [];
    runTransaction((database) => {
      const bookIds = [...new Set(highlights.map(h => h.book_id as string))];
      const placeholders = bookIds.map(() => '?').join(', ');
      const existingRows = database.exec(
        `SELECT book_id, content FROM highlights WHERE book_id IN (${placeholders})`,
        bookIds
      );
      const existingSet = new Set<string>();
      if (existingRows.length > 0 && existingRows[0].values.length > 0) {
        for (const row of existingRows[0].values) {
          existingSet.add(`${row[0]}:${row[1]}`);
        }
      }

      const stmt = database.prepare(
        `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const highlight of highlights) {
        const bookId = highlight.book_id as string;
        const content = highlight.content as string;

        if (existingSet.has(`${bookId}:${content}`)) {
          continue;
        }

        stmt.run([
          highlight.id,
          bookId,
          highlight.chapter_title ?? null,
          content,
          highlight.note ?? null,
          highlight.style ?? 0,
          highlight.range_start ?? null,
          highlight.range_end ?? null,
        ]);
        existingSet.add(`${bookId}:${content}`);
        newHighlightIds.push(highlight.id as string);
        newCount++;
      }

      stmt.free();
    });

    // 批量创建复习卡片
    if (newHighlightIds.length > 0) {
      try {
        cardsDb.createBatch(newHighlightIds);
      } catch (error) {
        logger.error('批量创建复习卡片失败', { error: String(error), count: newHighlightIds.length });
      }
    }

    return newCount;
  },

  update(id: string, highlight: Record<string, unknown>): void {
    writeRevision++;
    const updatableKeys = assertRealColumns(
      'highlights',
      Object.keys(highlight).filter(k => k !== 'id')
    );
    if (updatableKeys.length === 0) return;
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => highlight[k]);
    getDatabase().run(
      `UPDATE highlights SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  /**
   * 找出「有划线但章节名为空」的书籍 id。
   * 用于一次性补全历史数据（2026-09-16：实测 934 条划线章节名全空）。
   *
   * **必须排除正文为空的划线**：章节名的补全口径是「划线原文 → 章节」，
   * 正文为空的行**按定义不可能被匹配上**。实测有 7 条这样的空行，
   * 若不排除，这 7 本书会被每一轮补全反复重新拉取，永远收敛不了。
   */
  getBookIdsMissingChapterTitle(): string[] {
    const result = getDatabase().exec(
      `SELECT DISTINCT book_id FROM highlights
       WHERE (chapter_title IS NULL OR TRIM(chapter_title) = '')
         AND content IS NOT NULL AND TRIM(content) != ''
         AND book_id IS NOT NULL AND book_id != ''`
    );
    if (result.length === 0) return [];
    return result[0].values.map((row) => String(row[0]));
  },

  /**
   * 批量更新章节名（单事务，符合 B12）。
   * 与逐条 update 的区别：不会每条都触发一次落盘。
   */
  updateChapterTitles(updates: Array<{ id: string; chapterTitle: string }>): number {
    writeRevision++;
    const valid = updates.filter((u) => u && u.id && u.chapterTitle);
    if (valid.length === 0) return 0;
    // 同一行可能被匹配到两次（微信读书的划线、想法常常正文相同），
    // 去重后统计，否则返回的「更新条数」会比实际改动的行数多。
    const byId = new Map<string, string>();
    for (const u of valid) byId.set(u.id, u.chapterTitle);
    runTransaction((database) => {
      const stmt = database.prepare(
        "UPDATE highlights SET chapter_title = ?, updated_at = datetime('now') WHERE id = ?"
      );
      for (const [id, chapterTitle] of byId) stmt.run([chapterTitle, id]);
      stmt.free();
    });
    return byId.size;
  },

  /**
   * 检索索引的版本签名：条数 + 最新更新时间。
   *
   * 任何增删改（含章节名回填）都会让它变化，检索层据此判断要不要重建索引。
   * 放在 DB 层是因为 SQL 属于这一层（项目约定）。
   */
  getRetrievalSignature(): string {
    const result = getDatabase().exec(
      "SELECT COUNT(*), IFNULL(MAX(updated_at), '') FROM highlights"
    );
    const [count, latest] =
      result.length === 0 || result[0].values.length === 0
        ? [0, '']
        : [result[0].values[0][0], result[0].values[0][1]];
    return `${String(count)}:${String(latest)}:${writeRevision}`;
  },

  delete(id: string): void {
    writeRevision++;
    getDatabase().run('DELETE FROM highlights WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    writeRevision++;
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM highlights WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByBookId(bookId: string): void {
    writeRevision++;
    getDatabase().run('DELETE FROM highlights WHERE book_id = ?', [bookId]);
    saveDatabase();
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
    `);
    return rowsToObjects(result);
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      WHERE h.content LIKE ? OR h.note LIKE ?
      ORDER BY h.created_at DESC
    `, [pattern, pattern]);
    return rowsToObjects(result);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM highlights');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  countByBookId(bookId: string): number {
    const result = getDatabase().exec(
      'SELECT COUNT(*) FROM highlights WHERE book_id = ?',
      [bookId]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /**
   * 每本书每章还剩多少条**有正文**的划线 —— 摘要新鲜度判定的输入。
   *
   * 口径必须与 shared/chapter-summaries 的 groupHighlightsByChapter 一致
   * （空正文不算、章节名先 trim、空章名归「未分章」），否则通知面板报的数字
   * 和点进详情页真正要重做的章节对不上。tests/summary-freshness.test.ts 逐条钉住。
   */
  getChapterCounts(): Array<{ bookId: string; chapterTitle: string; count: number }> {
    const result = getDatabase().exec(
      `SELECT book_id, chapter_title, COUNT(*) AS count FROM (
         SELECT book_id,
                CASE WHEN chapter_title IS NULL OR TRIM(chapter_title) = ''
                     THEN ? ELSE TRIM(chapter_title) END AS chapter_title
         FROM highlights
         WHERE content IS NOT NULL AND TRIM(content) <> ''
       )
       GROUP BY book_id, chapter_title
       ORDER BY book_id, chapter_title`,
      [UNGROUPED_CHAPTER]
    );
    const rows = result.length > 0 ? result[0].values : [];
    return rows.map((row) => ({
      bookId: String(row[0]),
      chapterTitle: String(row[1]),
      count: Number(row[2]),
    }));
  },

  getRecent(limit: number = 20): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
      LIMIT ?
    `, [limit]);
    return rowsToObjects(result);
  },
};
