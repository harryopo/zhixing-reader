// 知行读书 — 章节名一次性补全（electron/services/chapter-title-backfill.ts）
//
// 背景：934 条划线章节名全空，三个导入入口都丢了章节对照表。
// 入口已修，但历史数据要靠这个批量修复。测试重点是三件事：
//   1. 按「划线原文」正确匹配并补上章节名
//   2. **绝不覆盖已有的章节名**（这是最危险的失败模式）
//   3. 幂等 —— 重复点不会反复写库

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

vi.mock('../electron/weread-api', () => ({
  fetchAllContent: vi.fn(),
}))

import { fetchAllContent } from '../electron/weread-api'
import { backfillChapterTitles } from '../electron/services/chapter-title-backfill'
import { booksDb, highlightsDb } from '../electron/database'

const mockedFetch = vi.mocked(fetchAllContent)

/** 造一本有划线的书 */
function seedBook(bookId: string, lines: Array<{ content: string; chapterTitle?: string }>) {
  booksDb.create({ id: bookId, title: `书 ${bookId}` } as never)
  lines.forEach((l, i) => {
    highlightsDb.create({
      id: `hl_${bookId}_${i}`,
      book_id: bookId,
      content: l.content,
      chapter_title: l.chapterTitle ?? null,
    } as never)
  })
}

/** 微信读书返回的一本书的内容 */
function apiPayload(chapters: Array<[number, string]>, marks: Array<[number, string]>) {
  return {
    bookmarks: marks.map(([uid, text]) => ({ chapterUid: uid, chapterTitle: '', markText: text, createTime: 0 })),
    notes: [],
    chapters: chapters.map(([uid, title]) => ({ chapterUid: uid, title, level: 1 })),
  }
}

describe('backfillChapterTitles — 补全历史划线的章节名', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    mockedFetch.mockReset()
  })
  afterEach(() => teardownTestDatabase())

  it('按划线原文匹配，把空的章节名补上', async () => {
    seedBook('b1', [{ content: '青年们都想认真地生活' }, { content: '如果不懂得如何构筑良好的人际关系' }])
    mockedFetch.mockResolvedValue(apiPayload(
      [[5, '第一章 人际关系']],
      [[5, '青年们都想认真地生活'], [5, '如果不懂得如何构筑良好的人际关系']],
    ) as never)

    const r = await backfillChapterTitles()
    expect(r.books).toBe(1)
    expect(r.updated).toBe(2)
    expect(r.failedBooks).toBe(0)

    const rows = highlightsDb.getByBookId('b1')
    expect(rows.every((h) => h.chapter_title === '第一章 人际关系')).toBe(true)
  })

  it('**绝不覆盖已有章节名**（最危险的失败模式）', async () => {
    seedBook('b1', [{ content: '已有章节的划线', chapterTitle: '我自己写的章节' }])
    mockedFetch.mockResolvedValue(apiPayload(
      [[5, '来自接口的章节']],
      [[5, '已有章节的划线']],
    ) as never)

    const r = await backfillChapterTitles()
    // 章节名不为空 → 该书根本不该进入待处理列表，连 API 都不该调
    expect(r.updated).toBe(0)
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(highlightsDb.getByBookId('b1')[0].chapter_title).toBe('我自己写的章节')
  })

  it('幂等：重复执行第二次不再产生更新', async () => {
    seedBook('b1', [{ content: 'A' }, { content: 'B' }])
    mockedFetch.mockResolvedValue(apiPayload([[1, '第一章']], [[1, 'A'], [1, 'B']]) as never)

    const first = await backfillChapterTitles()
    expect(first.updated).toBe(2)

    const second = await backfillChapterTitles()
    expect(second.updated).toBe(0)
    expect(second.books).toBe(0)
  })

  it('章节表里查不到时保持为空，**不写假值**', async () => {
    seedBook('b1', [{ content: '孤儿划线' }])
    mockedFetch.mockResolvedValue(apiPayload([], [[999, '孤儿划线']]) as never)

    const r = await backfillChapterTitles()
    expect(r.updated).toBe(0)
    expect(highlightsDb.getByBookId('b1')[0].chapter_title).toBeNull()
  })

  it('一本书拉取失败不影响其它书', async () => {
    seedBook('b1', [{ content: 'X' }])
    seedBook('b2', [{ content: 'Y' }])
    mockedFetch.mockImplementation(async (id: string) => {
      if (id === 'b1') throw new Error('网络错误')
      return apiPayload([[1, '第二章']], [[1, 'Y']]) as never
    })

    const r = await backfillChapterTitles()
    expect(r.failedBooks).toBe(1)
    expect(r.updated).toBe(1)
    expect(highlightsDb.getByBookId('b2')[0].chapter_title).toBe('第二章')
    expect(highlightsDb.getByBookId('b1')[0].chapter_title).toBeNull()
  })

  it('传入 bookId 时只处理那一本', async () => {
    seedBook('b1', [{ content: 'X' }])
    seedBook('b2', [{ content: 'Y' }])
    mockedFetch.mockResolvedValue(apiPayload([[1, '第一章']], [[1, 'X']]) as never)

    const r = await backfillChapterTitles('b1')
    expect(r.books).toBe(1)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith('b1')
    expect(highlightsDb.getByBookId('b2')[0].chapter_title).toBeNull()
  })

  it('没有任何缺章节名的书时直接返回，不调 API', async () => {
    seedBook('b1', [{ content: 'X', chapterTitle: '已有' }])
    const r = await backfillChapterTitles()
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(r).toEqual({ books: 0, scanned: 0, updated: 0, failedBooks: 0 })
  })

  it('正文为空的划线不算缺口（否则那几本书会被反复重拉）', async () => {
    // 实测真实数据里有 7 条正文为空的划线。章节名的匹配口径是「正文 → 章节」，
    // 空正文按定义永远匹配不上；若算作缺口，这几本书每一轮都会重新拉接口。
    seedBook('b1', [{ content: 'X' }])
    highlightsDb.update('hl_b1_0', { content: '' })

    const r = await backfillChapterTitles()
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(r).toEqual({ books: 0, scanned: 0, updated: 0, failedBooks: 0 })
  })

  it('同一行被匹配到两次时只算一条（返回的是真实改动行数）', () => {
    seedBook('b1', [{ content: 'A' }])
    const n = highlightsDb.updateChapterTitles([
      { id: 'hl_b1_0', chapterTitle: '第一章' },
      { id: 'hl_b1_0', chapterTitle: '第一章' },
    ])
    expect(n).toBe(1)
    expect(highlightsDb.getByBookId('b1')[0].chapter_title).toBe('第一章')
  })
})

