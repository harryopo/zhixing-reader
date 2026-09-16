// 知行读书 — 启动修复（electron/services/startup-repair.ts）
//
// 背景：2026-09-16 实测用户数据库发现三处"功能都在、数据全空"的断点
// （934 条划线章节名全空 / 90 张卡片来源全空 / 阅读时长恒为 0）。
// 三处的补全入口此前只挂在设置页按钮或每日同步上，而用户"很多也看不懂" ——
// 藏在设置页深处等于不修，所以改成启动后自动跑。
//
// 这里守四件事：
//   1. 真的有缺口时才动作，没有缺口时**一次网络请求都不发**
//   2. 网络部分按节流跑，不能每次启动都重复请求
//   3. 任何一步失败都不抛错（修复不能连累启动）
//   4. 并发调用只执行一次

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

const mockSettings = new Map<string, unknown>()

vi.mock('../electron/weread-api', () => ({
  fetchAllContent: vi.fn(),
  fetchReadingData: vi.fn(),
}))

vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    get: (k: string) => mockSettings.get(k),
    set: (k: string, v: unknown) => {
      mockSettings.set(k, v)
    },
    getAll: () => Object.fromEntries(mockSettings),
  },
}))

import { fetchAllContent, fetchReadingData } from '../electron/weread-api'
import { runStartupRepair } from '../electron/services/startup-repair'
import { booksDb, highlightsDb, knowledgeCardsDb, dailyStatsDb } from '../electron/database'

const mockedContent = vi.mocked(fetchAllContent)
const mockedReading = vi.mocked(fetchReadingData)

/** 微信读书返回的一本书的内容：章节对照表 + 划线 */
function apiPayload(chapters: Array<[number, string]>, marks: Array<[number, string]>) {
  return {
    bookmarks: marks.map(([uid, text]) => ({ chapterUid: uid, chapterTitle: '', markText: text, createTime: 0 })),
    notes: [],
    chapters: chapters.map(([uid, title]) => ({ chapterUid: uid, title, level: 1 })),
  }
}

describe('runStartupRepair — 启动时自动修复历史数据缺口', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    mockSettings.clear()
    mockedContent.mockReset()
    mockedReading.mockReset()
    mockedContent.mockResolvedValue(apiPayload([], []) as never)
    mockedReading.mockResolvedValue({ readTimes: {} } as never)
  })
  afterEach(() => teardownTestDatabase())

  it('补上知识卡片的来源划线（纯本地，零网络）', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: '一句话原文', chapter_title: '第一章' } as never)
    knowledgeCardsDb.create({
      id: 'kc1', book_id: 'b1', type: 'quote', title: 'T', content: '一句话原文',
    } as never)

    const r = await runStartupRepair()
    expect(r.cardSources).toBe(1)
    expect((knowledgeCardsDb.getById('kc1') as never as { source_highlight_id: string }).source_highlight_id).toBe('hl1')
  })

  it('补上划线的章节名', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: '青年们都想认真地生活' } as never)
    mockedContent.mockResolvedValue(
      apiPayload([[5, '第一章 人际关系']], [[5, '青年们都想认真地生活']]) as never,
    )

    const r = await runStartupRepair()
    expect(r.chapterTitles).toBe(1)
    expect(highlightsDb.getByBookId('b1')[0].chapter_title).toBe('第一章 人际关系')
  })

  it('没有缺口时**一次微信读书请求都不发**', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: 'X', chapter_title: '已有章节' } as never)

    const r = await runStartupRepair()
    expect(r.chapterTitles).toBe(0)
    expect(r.chapterSkipped).toBe(false)
    expect(mockedContent).not.toHaveBeenCalled()
  })

  it('章节名补全有节流：同一台机器短时间内不会反复重试', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: '拉不到的划线' } as never)
    // 接口永远查不到章节 → 缺口一直在，但节流必须拦住第二次
    mockedContent.mockResolvedValue(apiPayload([], [[999, '拉不到的划线']]) as never)

    await runStartupRepair()
    expect(mockedContent).toHaveBeenCalledTimes(1)

    const second = await runStartupRepair()
    expect(second.chapterSkipped).toBe(true)
    expect(mockedContent).toHaveBeenCalledTimes(1)
  })

  it('写回阅读时长，并同样受节流保护', async () => {
    mockedReading.mockResolvedValue({
      readTimes: { '1788710400': 1459 },
    } as never)

    const first = await runStartupRepair()
    expect(first.readingDays).toBe(1)
    const rows = dailyStatsDb.getRange('2026-09-06', '2026-09-06')
    expect((rows[0] as never as { reading_time: number }).reading_time).toBe(1459)

    await runStartupRepair()
    expect(mockedReading).toHaveBeenCalledTimes(1)
  })

  it('**任何一步失败都不抛错**，其余步骤照常完成', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: '原文' } as never)
    knowledgeCardsDb.create({
      id: 'kc1', book_id: 'b1', type: 'quote', title: 'T', content: '原文',
    } as never)
    mockedContent.mockRejectedValue(new Error('网络断了'))
    mockedReading.mockRejectedValue(new Error('网络断了'))

    const r = await runStartupRepair()
    expect(r.cardSources).toBe(1)   // 本地步骤不受网络影响
    expect(r.chapterTitles).toBe(0)
    expect(r.readingDays).toBe(0)
  })

  it('并发调用只执行一次（不会重复发请求）', async () => {
    booksDb.create({ id: 'b1', title: '书' } as never)
    highlightsDb.create({ id: 'hl1', book_id: 'b1', content: '原文' } as never)
    knowledgeCardsDb.create({
      id: 'kc1', book_id: 'b1', type: 'quote', title: 'T', content: '原文',
    } as never)

    const [a, b] = await Promise.all([runStartupRepair(), runStartupRepair()])
    expect(a.cardSources).toBe(1)
    expect(b.cardSources).toBe(0)   // 第二次被 in-flight 挡住
    expect(mockedReading).toHaveBeenCalledTimes(1)
  })

  it('全新安装（没有任何数据）也能安全跑完', async () => {
    const r = await runStartupRepair()
    expect(r).toEqual({ cardSources: 0, chapterTitles: 0, chapterSkipped: false, readingDays: 0 })
    expect(mockedContent).not.toHaveBeenCalled()
  })
})
