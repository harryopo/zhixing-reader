/**
 * database/highlights — 划线表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 * 依赖 cards：批量导入划线时自动创建 FSRS 复习卡片（原行为保留）。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
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

/**
 * 把调用方给的时间收成库里那一列一直在用的形状：`YYYY-MM-DD HH:MM:SS`（UTC）。
 *
 * 为什么不直接存 ISO：库里现存 934 条的 `created_at` 都是 `datetime('now')` 那个形状
 * （第 10 位是**空格**）。导入若写成 `...T...Z`，字符串比较时 `T`(0x54) > ` `(0x20) ⇒
 * 同一天里 ISO 那批会整体排在手填那条**之前**，划线列表与笔记页的先后顺序被格式悄悄改写。
 * 本项目在 `cards.due` 上就栽过同一个坑（ISO 带 T 与空格，字符串比较下今天到期整天不计）。
 * 解析不出来一律回 `null` —— 那就吃库的 DEFAULT，不编一个时间。
 */
function toSqliteDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

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

    // 不给 id 就自己造一个：sql.js 绑不了 `undefined`，以前调用方一漏写就在这条
    // INSERT 上抛「tried to bind a value of an unknown type」，而自动导入那两处把
    // create 包在 try/catch 里 ⇒ 每条都"失败"却只留一行日志，最后报的是
    // 「该书在微信读书中也没有笔记」—— 有笔记，是根本没插进去。
    const id = (highlight.id as string) ?? `hl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // 划线时间：调用方给了就照它写，没给才吃库里的 DEFAULT（=此刻）。
    // 三条导入通路一直都传 `created_at`，而这句 INSERT 原先没这一列 ⇒
    // 微信读书里真实划线时刻被整批落成"导入那一刻"（实测 934 条只剩 9 个不同时间戳，
    // 一秒里挤 329 条）。笔记页排序、统计页与档案页的按天归集都读这一列，
    // 时间被压平就等于历史阅读分布失真。
    const createdAt = toSqliteDateTime(highlight.created_at);

    const columns = ['id', 'book_id', 'chapter_title', 'content', 'note', 'style', 'range_start', 'range_end'];
    const values: unknown[] = [
      id,
      bookId,
      highlight.chapter_title ?? null,
      content,
      highlight.note ?? null,
      highlight.style ?? 0,
      highlight.range_start ?? null,
      highlight.range_end ?? null,
    ];
    if (createdAt !== null) {
      columns.push('created_at');
      values.push(createdAt);
    }
    const placeholders = columns.map(() => '?').join(', ');

    getDatabase().run(
      `INSERT INTO highlights (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
    saveDatabase();
    return true;
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

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
    `);
    return rowsToObjects(result);
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
};
