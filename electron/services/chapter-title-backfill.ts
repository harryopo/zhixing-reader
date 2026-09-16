/**
 * 章节名一次性补全 —— 修复历史数据
 *
 * ## 背景（2026-09-16 实测）
 * 用户数据库里 934 条划线，`chapter_title` 有值 **0 条**。
 * 根因是三个导入入口都把 `fetchAllContent` 一起取回来的章节对照表丢掉了
 * （详见 `src/shared/weread-content.ts` 的文件头注释）。
 *
 * 三个入口本身已经修好，但**只对以后新导入的划线生效** ——
 * 已有的 934 条不会自己变好，而用户不可能手动重新导入 92 本书。
 * 所以这里提供一个一次性的批量修复：按书重新拉一次微信读书内容，
 * 用「划线原文 → chapterUid → 章节标题」把历史数据补上。
 *
 * ## 为什么用「内容」做匹配
 * `highlights` 表没有存 `chapter_uid`，历史数据里也没有任何指向章节的字段。
 * 唯一可靠的对应关系就是划线原文本身（导入时的去重口径也是 `(book_id, content)`）。
 * 重新拉取的 `markText` 与库里存的 `content` 是同一份文本，可以直接对上。
 *
 * ## 幂等
 * 只更新「当前章节名为空」的行；已有章节名的不动。重复执行无副作用。
 */

import { fetchAllContent } from '../weread-api';
import { highlightsDb } from '../database';
import { resolveWereadContent } from '../../src/shared/weread-content';
import { logger } from '../logger';

export interface ChapterBackfillResult {
  /** 实际处理的书籍数 */
  books: number;
  /** 扫描到的划线/笔记条数 */
  scanned: number;
  /** 成功补上章节名的条数 */
  updated: number;
  /** 拉取失败的书籍数（不中断整体流程） */
  failedBooks: number;
}

/**
 * 补全章节名。
 * @param bookId 只处理这一本；省略则处理所有「有划线但章节名为空」的书
 */
export async function backfillChapterTitles(bookId?: string): Promise<ChapterBackfillResult> {
  const targets = bookId ? [bookId] : highlightsDb.getBookIdsMissingChapterTitle();

  const result: ChapterBackfillResult = { books: 0, scanned: 0, updated: 0, failedBooks: 0 };

  for (const id of targets) {
    try {
      const raw = await fetchAllContent(id) as {
        bookmarks: Array<{ chapterUid: number; chapterTitle?: string; markText: string }>;
        notes: Array<{ chapterUid: number; chapterTitle?: string; abstract: string }>;
        chapters?: Array<{ chapterUid: number; title: string; level?: number }>;
      };
      const { bookmarks, notes } = resolveWereadContent(raw);

      // 已存在的划线：content → 行（只看章节名为空的，避免无谓写库）
      const existing = highlightsDb.getByBookId(id);
      const missing = new Map<string, string>();
      for (const row of existing) {
        const content = String(row.content ?? '');
        const title = String(row.chapter_title ?? '').trim();
        const rowId = String(row.id ?? '');
        if (content && rowId && !title) missing.set(content, rowId);
      }
      if (missing.size === 0) continue;

      const updates: Array<{ id: string; chapterTitle: string }> = [];
      const consider = (text: string, title: string): void => {
        result.scanned++;
        if (!title) return;
        const rowId = missing.get(text);
        if (rowId) updates.push({ id: rowId, chapterTitle: title });
      };

      for (const bm of bookmarks) consider(bm.markText, bm.resolvedChapterTitle);
      for (const note of notes) consider(note.abstract, note.resolvedChapterTitle);

      result.updated += highlightsDb.updateChapterTitles(updates);
      result.books++;
    } catch (error) {
      result.failedBooks++;
      logger.warn('章节名补全失败（跳过该书）', { bookId: id, error: String(error) });
    }
  }

  logger.info('章节名补全完成', { ...result, requested: targets.length });
  return result;
}
