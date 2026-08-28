/**
 * ipc/books — 书籍 / 划线 / 复习卡片 / 复习记录 / 摘要 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import { booksDb, highlightsDb, cardsDb, reviewsDb, bookSummariesDb } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { indexHighlight as indexHighlightRAG } from '../services/rag-service';
import type { HandleFn } from './types';

export function registerBookHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.BOOKS.GET_ALL, () => booksDb.getAll());
  handle(IPC_CHANNELS.BOOKS.GET_BY_ID, (id: string) => booksDb.getById(id));
  handle(IPC_CHANNELS.BOOKS.CREATE, (book: Record<string, unknown>) => booksDb.create(book));
  handle(IPC_CHANNELS.BOOKS.UPDATE, (id: string, book: Record<string, unknown>) => booksDb.update(id, book));
  handle(IPC_CHANNELS.BOOKS.DELETE, (id: string) => booksDb.delete(id));
  handle(IPC_CHANNELS.BOOKS.UPDATE_PROGRESS, (id: string, progress: number) => booksDb.updateProgress(id, progress));
  handle(IPC_CHANNELS.BOOKS.SEARCH, (keyword: string) => booksDb.search(keyword));

  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, (bookId: string) => highlightsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, (id: string) => highlightsDb.getById(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.CREATE, (highlight: Record<string, unknown>) => {
    const id = (highlight.id as string) || `hl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const bookId = highlight.book_id ?? highlight.bookId;
    const created = highlightsDb.create({
      id,
      book_id: bookId,
      chapter_title: highlight.chapter_title ?? highlight.chapterTitle ?? null,
      content: highlight.content,
      note: highlight.note ?? null,
      style: highlight.style ?? 0,
      range_start: highlight.range_start ?? highlight.rangeStart ?? null,
      range_end: highlight.range_end ?? highlight.rangeEnd ?? null,
    });

    // Auto-index to vector DB in background (fire-and-forget)
    if (created) {
      // Single-create path used by bookshelf import — also create FSRS card (batch path already does)
      try {
        if (!cardsDb.getByHighlightId(id)) {
          cardsDb.create(id);
        }
      } catch (cardErr) {
        logger.error('Auto-create FSRS card failed', { highlightId: id, error: String(cardErr) });
      }

      const books = booksDb.getAll();
      const book = books.find(b => b.id === bookId);
      indexHighlightRAG({
        id,
        bookId: bookId as string,
        bookTitle: (book?.title as string) || 'Unknown',
        content: highlight.content as string,
        chapterTitle: (highlight.chapter_title ?? highlight.chapterTitle) as string | undefined,
        createdAt: new Date().toISOString(),
      }).catch(() => {})
    }

    return created;
  });
  handle(IPC_CHANNELS.HIGHLIGHTS.UPDATE, (id: string, highlight: Record<string, unknown>) => highlightsDb.update(id, highlight));
  handle(IPC_CHANNELS.HIGHLIGHTS.DELETE, (id: string) => highlightsDb.delete(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_ALL, () => highlightsDb.getAll());
  handle(IPC_CHANNELS.HIGHLIGHTS.SEARCH, (keyword: string) => highlightsDb.search(keyword));
  handle(IPC_CHANNELS.HIGHLIGHTS.EXPORT, async () => {
    const rawHighlights = await highlightsDb.getAll();
    if (!Array.isArray(rawHighlights) || rawHighlights.length === 0) {
      throw new Error('没有可导出的笔记');
    }
    const rawBooks = await booksDb.getAll();
    const bookMap = new Map(
      rawBooks.map((b) => [
        (b.id as string) ?? 'unknown',
        ((b.title as string) || '未知书籍'),
      ]),
    );

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: '导出读书笔记',
      defaultPath: 'zhixing-notes.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false, count: 0 };
    }

    const getBookId = (h: Record<string, unknown>): string =>
      ((h.book_id as string | undefined) || (h.bookId as string | undefined) || 'unknown');
    const getCreatedAt = (h: Record<string, unknown>): number => {
      const v = h.created_at as string | number | Date | undefined;
      if (!v) return 0;
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? 0 : t;
    };

    // 按书籍分组，书籍内按创建时间倒序
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const h of rawHighlights) {
      const bid = getBookId(h);
      const list = grouped.get(bid) || [];
      list.push(h);
      grouped.set(bid, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    const escapeMd = (s: unknown) => String(s ?? '').replace(/\n/g, '  \n');
    const lines: string[] = ['# 知行读书 · 读书笔记导出', '', `共 ${rawHighlights.length} 条笔记`, ''];
    for (const [bookId, list] of grouped) {
      lines.push(`## 《${bookMap.get(bookId) || '未知书籍'}》`, '');
      for (const h of list) {
        const chapter =
          ((h.chapter_title as string | undefined) || (h.chapterTitle as string | undefined) || '未知章节');
        const time = (h.created_at as string | undefined)
          ? new Date(h.created_at as string).toLocaleString('zh-CN')
          : '未知时间';
        lines.push(`### ${chapter}`, '', `**时间**：${time}`, '', `> ${escapeMd(h.content)}`, '');
        if (h.note) {
          lines.push(`**批注**：${escapeMd(h.note)}`, '');
        }
        lines.push('---', '');
      }
    }

    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf8');
    logger.info(`Highlights exported`, { count: rawHighlights.length, path: result.filePath });
    return { saved: true, count: rawHighlights.length, path: result.filePath };
  });

  handle(IPC_CHANNELS.CARDS.GET_BY_HIGHLIGHT, (highlightId: string) => cardsDb.getByHighlightId(highlightId));
  handle(IPC_CHANNELS.CARDS.GET_BY_ID, (id: string) => cardsDb.getById(id));
  handle(IPC_CHANNELS.CARDS.CREATE, (highlightId: string) => cardsDb.create(highlightId));
  handle(IPC_CHANNELS.CARDS.CREATE_BATCH, (highlightIds: string[]) => cardsDb.createBatch(highlightIds));
  handle(IPC_CHANNELS.CARDS.CREATE_FOR_EXISTING, () => cardsDb.createForExistingHighlights());
  handle(IPC_CHANNELS.CARDS.UPDATE, (card: Record<string, unknown>) => cardsDb.update(card as unknown as Parameters<typeof cardsDb.update>[0]));
  handle(IPC_CHANNELS.CARDS.UPDATE_APPLICATION_TAG, (id: string, tag: string) => cardsDb.updateApplicationTag(id, tag));
  handle(IPC_CHANNELS.CARDS.UPDATE_MASTERY_LEVEL, (id: string, level: number) => cardsDb.updateMasteryLevel(id, level));
  handle(IPC_CHANNELS.CARDS.DELETE, (id: string) => cardsDb.delete(id));
  handle(IPC_CHANNELS.CARDS.GET_DUE, (limit?: number) => cardsDb.getDueCards(limit));
  handle(IPC_CHANNELS.CARDS.GET_DUE_WITH_CONTENT, (limit?: number) => cardsDb.getDueCardsWithContent(limit));
  handle(IPC_CHANNELS.CARDS.GET_BY_BOOK, (bookId: string) => cardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.CARDS.GET_STATS, () => cardsDb.getReviewStats());

  handle(IPC_CHANNELS.REVIEWS.CREATE, (cardId: string, rating: Parameters<typeof reviewsDb.create>[1]) => reviewsDb.create(cardId, rating));
  handle(IPC_CHANNELS.REVIEWS.GET_BY_CARD, (cardId: string) => reviewsDb.getByCardId(cardId));
  handle(IPC_CHANNELS.REVIEWS.GET_RECENT, (limit?: number) => reviewsDb.getRecent(limit));

  handle(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, (bookId: string) => bookSummariesDb.getByBookId(bookId));
  handle(IPC_CHANNELS.SUMMARIES.CREATE, (bookId: string, summary: string, keyPoints?: string) =>
    bookSummariesDb.create(bookId, summary, keyPoints)
  );
  handle(IPC_CHANNELS.SUMMARIES.DELETE, (bookId: string) => bookSummariesDb.delete(bookId));
}
