// 知行读书 — 层级摘要生成服务（electron/services/chapter-summary-service.ts）
//
// 真库（复用生产 schema 的内存 sql.js）+ 假 AI。要钉住的是**花钱的边界**：
//   · 首次生成才逐章调用 AI；
//   · 划线没变时第二次点击必须一次都不调；
//   · 一章失败不能带崩整本书；
//   · 同一时刻只允许一本书在生成。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, chapterSummariesDb, getDatabase } from '../electron/database'

const { mockChapterSummary, mockBookSummary } = vi.hoisted(() => ({
  mockChapterSummary: vi.fn(async (_bookTitle: string, chapterTitle: string) => `「${chapterTitle}」的章节摘要`),
  mockBookSummary: vi.fn(async () => ({ summary: '全书摘要', keyPoints: ['要点一', '要点二'] })),
}))

vi.mock('../electron/ai-service', () => ({
  generateChapterSummary: mockChapterSummary,
  generateBookSummary: mockBookSummary,
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { generateBookSummaries, isGenerating } from '../electron/services/chapter-summary-service'

const BOOK_ID = 'book_summary_test'

function addHighlight(id: string, chapterTitle: string | null, content: string): void {
  getDatabase().run(
    'INSERT INTO highlights (id, book_id, chapter_title, content) VALUES (?, ?, ?, ?)',
    [id, BOOK_ID, chapterTitle, content],
  )
}

beforeEach(async () => {
  await setupTestDatabase()
  vi.clearAllMocks()
  mockChapterSummary.mockImplementation(async (_bookTitle: string, chapterTitle: string) => `「${chapterTitle}」的章节摘要`)
  mockBookSummary.mockImplementation(async () => ({ summary: '全书摘要', keyPoints: ['要点一', '要点二'] }))
  booksDb.create({ id: BOOK_ID, title: '被讨厌的勇气' })
})

afterEach(() => {
  teardownTestDatabase()
})

describe('generateBookSummaries —— L1 章节摘要', () => {
  it('每个章节调用一次 AI 并落库，source_count 记录该章划线条数', async () => {
    addHighlight('h1', '第一夜', 'a')
    addHighlight('h2', '第一夜', 'b')
    addHighlight('h3', '第二夜', 'c')

    const result = await generateBookSummaries(BOOK_ID)

    expect(result.generated).toBe(2)
    expect(mockChapterSummary).toHaveBeenCalledTimes(2)
    const rows = chapterSummariesDb.getByBookId(BOOK_ID)
    expect(rows.map((r) => [r.chapterTitle, r.sourceCount])).toEqual([['第一夜', 2], ['第二夜', 1]])
  })

  it('全书摘要（L2）由章节摘要汇总后写入 book_summaries', async () => {
    addHighlight('h1', '第一夜', 'a')
    await generateBookSummaries(BOOK_ID)

    expect(mockBookSummary).toHaveBeenCalledTimes(1)
    // L2 的输入是 L1 的产出，不是划线原文
    expect(mockBookSummary.mock.calls[0][1]).toContain('[第一夜] 「第一夜」的章节摘要')
    const stored = getDatabase().exec('SELECT summary, key_points FROM book_summaries WHERE book_id = ?', [BOOK_ID])
    expect(String(stored[0].values[0][0])).toBe('全书摘要')
    expect(JSON.parse(String(stored[0].values[0][1]))).toEqual(['要点一', '要点二'])
  })

  it('正文为空的划线不成章 —— 补不出摘要也就不花 AI 调用', async () => {
    addHighlight('h1', '第一夜', '   ')
    const result = await generateBookSummaries(BOOK_ID)

    expect(result.generated).toBe(0)
    expect(mockChapterSummary).not.toHaveBeenCalled()
    expect(result.bookSummary).toBe(false)
  })

  it('一章失败只记 failed，其余章节照常落库', async () => {
    addHighlight('h1', '第一夜', 'a')
    addHighlight('h2', '第二夜', 'b')
    mockChapterSummary.mockImplementationOnce(async () => {
      throw new Error('AI 超时')
    })

    const result = await generateBookSummaries(BOOK_ID)

    expect(result).toMatchObject({ generated: 1, failed: 1 })
    expect(chapterSummariesDb.getByBookId(BOOK_ID)).toHaveLength(1)
  })
})

describe('generateBookSummaries —— 增量复用（这是分章的全部意义）', () => {
  it('第二次点击在划线没变时一次 AI 都不调，也不重写全书摘要', async () => {
    addHighlight('h1', '第一夜', 'a')
    addHighlight('h2', '第二夜', 'b')
    await generateBookSummaries(BOOK_ID)
    vi.clearAllMocks()

    const result = await generateBookSummaries(BOOK_ID)

    expect(mockChapterSummary).not.toHaveBeenCalled()
    expect(mockBookSummary).not.toHaveBeenCalled()
    expect(result).toMatchObject({ generated: 0, skipped: 2, failed: 0, bookSummary: false })
  })

  it('新增加一章的划线，只重做那一章', async () => {
    addHighlight('h1', '第一夜', 'a')
    addHighlight('h2', '第二夜', 'b')
    await generateBookSummaries(BOOK_ID)
    vi.clearAllMocks()

    addHighlight('h3', '第三夜', 'c')
    const result = await generateBookSummaries(BOOK_ID)

    expect(mockChapterSummary.mock.calls.map((call) => call[1])).toEqual(['第三夜'])
    expect(result).toMatchObject({ generated: 1, skipped: 2 })
    // L1 变了，L2 才值得重烧一次
    expect(mockBookSummary).toHaveBeenCalledTimes(1)
  })
})

describe('generateBookSummaries —— 并发保护', () => {
  it('一本书还在生成时，第二次调用直接报错而不是排双份 AI 花费', async () => {
    addHighlight('h1', '第一夜', 'a')
    let release: () => void = () => {}
    mockChapterSummary.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        release = () => resolve('摘要')
      }),
    )

    const first = generateBookSummaries(BOOK_ID)
    expect(isGenerating()).toBe(true)
    await expect(generateBookSummaries(BOOK_ID)).rejects.toThrow(/正在为另一本书生成摘要/)

    release()
    await first
    expect(isGenerating()).toBe(false)
  })

  it('书籍不存在时报错，不留半截状态', async () => {
    await expect(generateBookSummaries('book_not_exists')).rejects.toThrow('书籍不存在')
    expect(isGenerating()).toBe(false)
  })
})
