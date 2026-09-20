// 摘要新鲜度：DB 汇总必须与 shared 的判定同口径
//
// 为什么单独一份集成测试：通知面板那句「N 本书的 AI 摘要待更新」走的是 SQL 汇总
// （一次 GROUP BY，不逐本书拉全量划线），而真正生成时走的是 groupHighlightsByChapter +
// planChapterSummaries（内存里分章）。两套判定只要口径不同，就会出现「报了却点不动」
// 或「点了发现无事可做」—— 所以拿同一批真实数据比一次，漂移动不动就红。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, chapterSummariesDb, highlightsDb } from '../electron/database'
import { findPendingSummaries } from '../electron/services/chapter-summary-service'
import {
  UNGROUPED_CHAPTER,
  findPendingSummaryBooks,
  groupHighlightsByChapter,
  planChapterSummaries,
} from '../src/shared/chapter-summaries'

function addBook(id: string, title = `《${id}》`): void {
  booksDb.create({ id, title } as never)
}

function addHighlight(id: string, bookId: string, chapterTitle: string | null, content: string): void {
  highlightsDb.create({ id, book_id: bookId, chapter_title: chapterTitle, content, style: 0 } as never)
}

describe('highlightsDb.getChapterCounts —— 每本书每章还有多少条有效划线', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })
  afterEach(() => {
    teardownTestDatabase()
  })

  it('与 groupHighlightsByChapter 给出同样的章与条数：空正文不算、章节名先 trim、空章名归「未分章」', () => {
    addBook('b1')
    addHighlight('h1', 'b1', '第一章', '内容一')
    addHighlight('h2', 'b1', ' 第一章 ', '内容二')
    addHighlight('h3', 'b1', '第二章', '内容三')
    addHighlight('h4', 'b1', null, '内容四')
    addHighlight('h5', 'b1', '第三章', '   ')

    const asKeys = (rows: Array<{ chapterTitle: string; count: number }>) =>
      rows.map((r) => `${r.chapterTitle}=${r.count}`).sort()

    expect(asKeys(highlightsDb.getChapterCounts().filter((row) => row.bookId === 'b1'))).toEqual(
      [`第一章=2`, `第二章=1`, `${UNGROUPED_CHAPTER}=1`].sort(),
    )

    // 同一批划线走内存路径（生成时真实用的那套），结论必须一模一样
    const memory = groupHighlightsByChapter(
      highlightsDb.getByBookId('b1').map((row) => ({
        chapterTitle: row.chapter_title as string | null,
        content: row.content as string | null,
      })),
    )
    expect(asKeys(memory.map((g) => ({ chapterTitle: g.chapterTitle, count: g.total })))).toEqual(
      asKeys(highlightsDb.getChapterCounts().filter((row) => row.bookId === 'b1')),
    )
  })

  it('两本书各算各的，不串书', () => {
    addBook('b1')
    addBook('b2')
    addHighlight('h1', 'b1', '第一章', 'a')
    addHighlight('h2', 'b2', '第一章', 'b')
    addHighlight('h3', 'b2', '第一章', 'c')

    const counts = highlightsDb.getChapterCounts()
    expect(counts.find((r) => r.bookId === 'b1')?.count).toBe(1)
    expect(counts.find((r) => r.bookId === 'b2')?.count).toBe(2)
  })
})

describe('chapterSummariesDb.getAllSourceCounts —— 已存摘要基于多少条划线', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })
  afterEach(() => {
    teardownTestDatabase()
  })

  it('逐本返回章节与当时的划线条数', () => {
    addBook('b1')
    addBook('b2')
    chapterSummariesDb.upsertBatch('b1', [{ chapterTitle: '第一章', summary: 's', sourceCount: 5 }])
    chapterSummariesDb.upsertBatch('b2', [{ chapterTitle: '第二章', summary: 's', sourceCount: 3 }])

    expect(chapterSummariesDb.getAllSourceCounts()).toEqual([
      { bookId: 'b1', chapterTitle: '第一章', sourceCount: 5 },
      { bookId: 'b2', chapterTitle: '第二章', sourceCount: 3 },
    ])
  })

  it('端到端：摘要写好后不再报，新加一条划线就报这一章', () => {
    addBook('b1')
    addHighlight('h1', 'b1', '第一章', 'a')
    addHighlight('h2', 'b1', '第一章', 'b')

    const storedFor = () =>
      chapterSummariesDb.getAllSourceCounts().map((r) => ({
        bookId: r.bookId,
        chapterTitle: r.chapterTitle,
        sourceCount: r.sourceCount,
      }))
    const countsFor = () => highlightsDb.getChapterCounts()

    // 先按 planChapterSummaries 的口径生成（这里只写库，不调 AI）
    const groups = groupHighlightsByChapter(
      highlightsDb.getByBookId('b1').map((row) => ({
        chapterTitle: row.chapter_title as string | null,
        content: row.content as string | null,
      })),
    )
    const plan = planChapterSummaries(groups, chapterSummariesDb.getSourceCounts('b1'))
    chapterSummariesDb.upsertBatch(
      'b1',
      plan.toGenerate.map((g) => ({ chapterTitle: g.chapterTitle, summary: '概括', sourceCount: g.total })),
    )
    expect(findPendingSummaryBooks(countsFor(), storedFor())).toEqual([])

    addHighlight('h3', 'b1', '第一章', 'c')
    expect(findPendingSummaryBooks(countsFor(), storedFor())).toEqual([
      { bookId: 'b1', pendingChapters: 1 },
    ])
  })
})

describe('findPendingSummaries —— 通知面板要的那份清单', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })
  afterEach(() => {
    teardownTestDatabase()
  })

  it('带书名与待办章节数；已经新鲜的书不出现', () => {
    addBook('b1', '《被讨厌的勇气》')
    addBook('b2', '《思考，快与慢》')
    addHighlight('h1', 'b1', '第一章', 'a')
    chapterSummariesDb.upsertBatch('b1', [{ chapterTitle: '第一章', summary: 's', sourceCount: 1 }])
    addHighlight('h2', 'b2', '第一章', 'b')
    addHighlight('h3', 'b2', '第二章', 'c')

    expect(findPendingSummaries()).toEqual([
      { bookId: 'b2', title: '《思考，快与慢》', pendingChapters: 2 },
    ])
  })

  it('只给最欠的几本，多的先不看', () => {
    addBook('b1')
    addBook('b2')
    addHighlight('h1', 'b1', '第一章', 'a')
    addHighlight('h2', 'b2', '第一章', 'b')

    expect(findPendingSummaries(1)).toHaveLength(1)
  })
})
