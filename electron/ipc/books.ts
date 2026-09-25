/**
 * ipc/books — 书籍 / 划线 / 复习卡片 / 复习记录 / 摘要 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import { booksDb, highlightsDb, cardsDb, reviewsDb, bookSummariesDb, chapterSummariesDb } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { settingsService } from '../services/settings-service';
import { backfillChapterTitles } from '../services/chapter-title-backfill';
import { findPendingSummaries, generateBookSummaries } from '../services/chapter-summary-service';
import {
  isReviewSourceKind,
  type ReviewSourceKind,
  type ReviewSourceRef,
} from '../../src/shared/review-sources';
import { DEFAULT_NEW_CARDS_PER_DAY } from '../../src/shared/study-limits';
import type { HandleFn } from './types';

/** 读取用户配置的每日新卡上限（未设置时用默认值） */
function newCardsPerDay(): unknown {
  try {
    const raw = settingsService.get('newCardsPerDay');
    return raw ?? DEFAULT_NEW_CARDS_PER_DAY;
  } catch {
    return DEFAULT_NEW_CARDS_PER_DAY;
  }
}

export function registerBookHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.BOOKS.GET_ALL, () => booksDb.getAll());
  handle(IPC_CHANNELS.BOOKS.GET_BY_ID, (id: string) => booksDb.getById(id));
  handle(IPC_CHANNELS.BOOKS.CREATE, (book: Record<string, unknown>) => booksDb.create(book));
  handle(IPC_CHANNELS.BOOKS.UPDATE, (id: string, book: Record<string, unknown>) => booksDb.update(id, book));
  handle(IPC_CHANNELS.BOOKS.DELETE, (id: string) => booksDb.delete(id));
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

      // 这里原来会给新建的划线建一条向量索引（Vectra + embeddings）。
      // 语义检索已整套移除（本机服务商没有 /embeddings 接口，索引一直是空的），
      // 现在检索走本地 BM25，索引按 DB 签名自动重建 —— 不需要在这里做任何事。
    }

    return created;
  });
  handle(IPC_CHANNELS.HIGHLIGHTS.UPDATE, (id: string, highlight: Record<string, unknown>) => highlightsDb.update(id, highlight));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_ALL, () => highlightsDb.getAll());
  // 一次性补全历史划线的章节名（见 services/chapter-title-backfill.ts）
  handle(IPC_CHANNELS.HIGHLIGHTS.BACKFILL_CHAPTER_TITLES, (bookId?: string) =>
    backfillChapterTitles(bookId));
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

  handle(IPC_CHANNELS.CARDS.GET_DUE, (limit?: number) => cardsDb.getDueCards(limit, newCardsPerDay()));
  handle(IPC_CHANNELS.CARDS.GET_DUE_WITH_CONTENT, (limit?: number) => cardsDb.getDueCardsWithContent(limit, newCardsPerDay()));
  handle(IPC_CHANNELS.CARDS.GET_QUEUE_STATS, () => cardsDb.getDueQueueStats(newCardsPerDay()));
  handle(IPC_CHANNELS.CARDS.GET_BY_BOOK, (bookId: string) => cardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.CARDS.GET_STATS, () => cardsDb.getReviewStats());

  // ===== 加入 / 移出复习队列（划线以外的两种来源由界面主动入队）=====
  // kind 与 ids 都来自渲染层，先过白名单再进数据库：不在名单里的类型直接拒，
  // 而不是让它变成一个查不到东西的列名。
  const requireKind = (kind: unknown): ReviewSourceKind => {
    if (!isReviewSourceKind(kind)) throw new Error(`不支持放进复习队列的来源类型：${String(kind)}`);
    return kind;
  };

  // 单条与批量走同一条通道：ids 就是长度为 1 的数组，省一次往返也省一条通道
  handle(IPC_CHANNELS.CARDS.ENROLL, (kind: unknown, ids: unknown) => {
    const sourceKind = requireKind(kind);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === '')) {
      throw new Error('要加入复习队列的 id 不合法');
    }
    const result = cardsDb.enrollMany(
      (ids as string[]).map((id): ReviewSourceRef => ({ kind: sourceKind, id })),
    );
    return { ...result, actionable: cardsDb.getDueQueueStats(newCardsPerDay()).actionable };
  });

  handle(IPC_CHANNELS.CARDS.UNENROLL, (kind: unknown, id: unknown) => {
    const source = { kind: requireKind(kind), id: String(id) };
    return { removed: cardsDb.unenroll(source) };
  });

  handle(IPC_CHANNELS.CARDS.ENROLLED_SOURCES, (kind: unknown) => {
    if (!isReviewSourceKind(kind)) return { ids: [] as string[] };
    return { ids: cardsDb.enrolledIds(kind) };
  });

  handle(IPC_CHANNELS.REVIEWS.CREATE, (cardId: string, rating: Parameters<typeof reviewsDb.create>[1]) => reviewsDb.create(cardId, rating));
  handle(IPC_CHANNELS.REVIEWS.GET_RECENT, (limit?: number) => reviewsDb.getRecent(limit));

  handle(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, (bookId: string) => bookSummariesDb.getByBookId(bookId));

  handle(IPC_CHANNELS.SUMMARIES.GET_CHAPTERS, (bookId: string) => chapterSummariesDb.getByBookId(bookId));
  handle(IPC_CHANNELS.SUMMARIES.GENERATE, (bookId: string) => generateBookSummaries(bookId));
  /** 哪些书欠摘要：纯本地一次汇总，不触发任何 AI 调用 */
  handle(IPC_CHANNELS.SUMMARIES.FRESHNESS, () => findPendingSummaries());
}
