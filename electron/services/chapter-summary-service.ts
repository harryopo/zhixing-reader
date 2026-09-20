/**
 * chapter-summary-service —— 书籍层级摘要（RAPTOR 简化版）
 *
 * L1：按章节把划线圈交给 AI 概括，一章一条，落在 chapter_summaries。
 * L2：把 L1 的各章摘要再汇总成全书摘要，落在 book_summaries。
 *
 * 为什么要分两层，而不是一次把 934 条划线塞进提示词：
 * 一次全量既撑不进上下文，也没法增量 —— 新加一条划线就得把整本书重烧一遍。
 * 分章之后，「同步了一次书架」只重做真正变了的那几章。
 *
 * 注意：本文件里的判定（分组 / 新鲜度）全在 src/shared/chapter-summaries.ts，
 * 这里只负责取数、烧 AI、写库。
 */
import { logger } from '../logger'
import { booksDb, highlightsDb, bookSummariesDb, chapterSummariesDb } from '../database'
import { generateBookSummary, generateChapterSummary } from '../ai-sdk-service'
import {
  findPendingSummaryBooks,
  formatChapterContents,
  formatChapterSummariesForBook,
  groupHighlightsByChapter,
  planChapterSummaries,
} from '../../src/shared/chapter-summaries'
import type { PendingSummaryEntry } from '../../src/shared/types'

export interface BookSummaryRunResult {
  bookTitle: string
  /** 本次真正调用 AI 生成的章节数 */
  generated: number
  /** 划线条数没变、复用已有摘要的章节数 */
  skipped: number
  /** 调用失败（含 AI 报错与返回空）的章节数 */
  failed: number
  /** 全书摘要（L2）是否写入 */
  bookSummary: boolean
}

/** 每攒够这么多条章节摘要落一次盘：一章一写会把整库导盘 N 次 */
const FLUSH_EVERY = 5

/** 同一时刻只允许一本书在生成 —— 连点两下就是双份 AI 花费 */
let runningBookId: string | null = null

export function isGenerating(): boolean {
  return runningBookId !== null
}

/** 通知面板一屏能放下的本数，剩下的下次再看 */
const PENDING_LIST_LIMIT = 6

/**
 * 「哪些书欠摘要」——纯本地一次 SQL 汇总，不打 AI、不花钱。
 *
 * 数字必须与生成时用的判定同源（shared 的 findPendingSummaryBooks），
 * 否则通知里写着 3 章、点进去发现无章可更。
 */
export function findPendingSummaries(limit = PENDING_LIST_LIMIT): PendingSummaryEntry[] {
  const titles = new Map(
    booksDb.getAll().map((book) => [String(book.id), String(book.title ?? '')]),
  )
  return findPendingSummaryBooks(
    highlightsDb.getChapterCounts(),
    chapterSummariesDb.getAllSourceCounts(),
  )
    .slice(0, limit)
    .flatMap((entry) => {
      const title = titles.get(entry.bookId)
      return title ? [{ ...entry, title }] : []
    })
}

export async function generateBookSummaries(bookId: string): Promise<BookSummaryRunResult> {
  if (runningBookId) {
    throw new Error(`正在为另一本书生成摘要，请等它完成`)
  }
  runningBookId = bookId
  try {
    return await run(bookId)
  } finally {
    runningBookId = null
  }
}

async function run(bookId: string): Promise<BookSummaryRunResult> {
  const book = booksDb.getById(bookId)
  const bookTitle = String(book?.title ?? '')
  if (!book || !bookTitle) throw new Error('书籍不存在')

  const rows = highlightsDb.getByBookId(bookId) as Array<Record<string, unknown>>
  const groups = groupHighlightsByChapter(
    rows.map((row) => ({
      chapterTitle: row.chapter_title as string | null,
      content: row.content as string | null,
    })),
  )

  const plan = planChapterSummaries(groups, chapterSummariesDb.getSourceCounts(bookId))
  logger.info('章节摘要计划', {
    bookId,
    chapters: groups.length,
    toGenerate: plan.toGenerate.length,
    skipped: plan.toSkip.length,
  })

  let failed = 0
  const pending: Array<{ chapterTitle: string; summary: string; sourceCount: number }> = []

  for (const group of plan.toGenerate) {
    try {
      const summary = await generateChapterSummary(
        bookTitle,
        group.chapterTitle,
        formatChapterContents(group),
      )
      pending.push({ chapterTitle: group.chapterTitle, summary, sourceCount: group.total })
      if (pending.length >= FLUSH_EVERY) {
        chapterSummariesDb.upsertBatch(bookId, pending.splice(0, pending.length))
      }
    } catch (error) {
      failed++
      logger.error('章节摘要生成失败', { bookId, chapter: group.chapterTitle, error: String(error) })
    }
  }
  if (pending.length > 0) {
    chapterSummariesDb.upsertBatch(bookId, pending)
  }

  const generated = plan.toGenerate.length - failed
  // L1 没有任何变化时不重烧 L2：重复点按钮不该再花一次钱
  const bookSummary = plan.toGenerate.length > 0 || !bookSummariesDb.getByBookId(bookId)
    ? await writeBookSummary(bookId, bookTitle)
    : false

  return { bookTitle, generated, skipped: plan.toSkip.length, failed, bookSummary }
}

async function writeBookSummary(bookId: string, bookTitle: string): Promise<boolean> {
  const chapters = chapterSummariesDb.getByBookId(bookId)
  if (chapters.length === 0) return false

  try {
    const { summary, keyPoints } = await generateBookSummary(
      bookTitle,
      formatChapterSummariesForBook(
        chapters.map((c) => ({ chapterTitle: c.chapterTitle, summary: c.summary })),
      ),
    )
    bookSummariesDb.create(bookId, summary, JSON.stringify(keyPoints))
    return true
  } catch (error) {
    logger.error('全书摘要生成失败', { bookId, error: String(error) })
    return false
  }
}
