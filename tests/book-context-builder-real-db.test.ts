// 书籍上下文构建器（划线检索 + 层级摘要两层）—— 真库判据
//
// 起点是覆盖率清单那两条：`book-context-builder` 99.27/76.47（摘要层的装配一条判据没有）、
// `rag-service` 92.68/71.42（失败那半壁没走过）。这一层决定的是「AI 回答关于书的问题时，
// 手里有没有你划的线、你写的想法、以及那本书的概括」。
//
// mock 只打在 logger 与"读库会炸"这一条缝上（`vi.spyOn(highlightsDb, 'getAll')`），
// 其余全走真实通路：真库、真 BM25、真 SQL。
//
// 本批量出来的两条生产缺陷（都有判据，且把修复改回去会红）：
//   ① 用户自己写的想法（note）以前根本不进检索 —— 全局搜索与笔记页都搜 `note`，
//      这一层建索引只喂 `content` ⇒ 同一个关键词三台两种答法（第三次）。
//   ② 下游 `rag-service` 把读库失败演成空数组 ⇒ 面板只能说「无命中」，而这一层的
//      catch 从来没机会看见失败。现在两层各归各的失败：划线炸了摘要照样带，
//      且原因一路带到 `metadata.error`（对话面板据此才说得出「读取失败」）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  booksDb,
  chapterSummariesDb,
  bookSummariesDb,
  getDatabase,
  highlightsDb,
} from '../electron/database'
import type { BuildContext, ContextBuildResult } from '../electron/agent/context-builder'
import { invalidateRetrievalIndex } from '../electron/services/rag-service'
import { globalSearch } from '../electron/services/global-search'

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../electron/logger', () => ({ logger }))

import { BookContextBuilder } from '../electron/agent/builders/book-context-builder'

const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  sessionId: 's1',
  bookId: 'b1',
  userMessage: '课题分离',
  conversationHistory: [],
  ...overrides,
})

// 交回的 metadata 是声明好的形状（electron/agent/context-builder.ts），
// 测试这边不再自己内联一份行类型 —— 那份声明漂了，两边各说各话正是本项目的老病。
const previewsOf = (r: ContextBuildResult) => r.metadata?.previews ?? []
const sourcesOf = (r: ContextBuildResult) => r.metadata?.sources ?? []

/** 把"注入文本里有哪几章"读出来，便于逐章对账 */
function injectedChapterTitles(content: string): string[] {
  return content
    .split('\n\n')
    .filter((line) => line.startsWith('【第'))
    .map((line) => line.slice(1, line.indexOf('】')))
}

function seed() {
  booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
  booksDb.create({ id: 'b2', title: '掌控习惯' } as never)

  highlightsDb.create({
    id: 'h1',
    book_id: 'b1',
    chapter_title: '第二夜',
    content: '一切烦恼都来自人际关系',
    note: '拖延让我错过每一次表达',
  } as never)
  // 章节名为 NULL 的那条：注入文本的出处要退回书名
  highlightsDb.create({ id: 'h2', book_id: 'b1', content: '所谓自由就是被别人讨厌' } as never)
  highlightsDb.create({
    id: 'h3',
    book_id: 'b1',
    chapter_title: '第三夜',
    content: '课题分离的实践方法',
  } as never)
  highlightsDb.create({
    id: 'h4',
    book_id: 'b2',
    chapter_title: '第一章',
    content: '习惯的养成需要环境设计',
  } as never)

  // 8 章摘要：前 4 章含「课题分离」，后 4 章不含；每章都是 9 个字 ⇒ 打分并列。
  // 并列时谁进前 3 由库里 `ORDER BY chapter_title` 决定 —— 章名用 ASCII 编号才排得稳
  // （'第一章…第八章' 按 Unicode 码位是 一<七<三<二<五<八<六<四，判据写不出人话）
  const matching = ['第01章', '第02章', '第03章', '第04章']
  const others = ['第05章', '第06章', '第07章', '第08章']
  chapterSummariesDb.upsertBatch(
    'b1',
    matching.map((chapterTitle, i) => ({
      chapterTitle,
      summary: `本章讲课题分离之${['一', '二', '三', '四'][i]}`,
      sourceCount: 3,
    })),
  )
  chapterSummariesDb.upsertBatch(
    'b1',
    others.map((chapterTitle) => ({
      chapterTitle,
      summary: '本章讲睡眠记忆一二',
      sourceCount: 2,
    })),
  )
  // 另一本书的摘要：选了 b1 时一条都不许进来
  chapterSummariesDb.upsertBatch('b2', [
    { chapterTitle: '第01章', summary: '习惯这本书里的课题分离之谈', sourceCount: 1 },
  ])
  bookSummariesDb.create('b1', '全书讲课题分离的展开')
}

describe('BookContextBuilder 两层装配（真库）', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    seed()
  })
  afterEach(() => teardownTestDatabase())

  it('选了书：摘要层与划线层都在，且摘要排在笔记之前', async () => {
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).toContain('## 书籍摘要')
    expect(result.content).toContain('## 阅读笔记')
    expect(result.content.indexOf('## 书籍摘要')).toBeLessThan(
      result.content.indexOf('## 阅读笔记'),
    )
    expect(result.content).toContain('【全书】全书讲课题分离的展开')
    expect(result.content).toContain('课题分离的实践方法')
  })

  it('章节摘要只带最相关的 3 章，第 4 章与不相关的章都不进', async () => {
    const result = await new BookContextBuilder().build(ctx())
    expect(injectedChapterTitles(result.content)).toEqual(['第01章', '第02章', '第03章'])
    expect(result.content).not.toContain('第04章')
    expect(result.content).not.toContain('第05章')
  })

  it('别的书的摘要一条都不带（选了 b1 就不该看见 b2）', async () => {
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).not.toContain('习惯这本书里的课题分离之谈')
  })

  it('没选书时跨全部书检索划线，但摘要层不参与（摘要按书存）', async () => {
    const result = await new BookContextBuilder().build(ctx({ bookId: undefined }))
    expect(result.content).not.toContain('## 书籍摘要')
    expect(result.content).toContain('全部书籍')
    expect(result.content).toContain('课题分离的实践方法')
    expect(result.metadata?.itemCount).toBe(1)
  })

  it('选了书就不说「来自全部书籍」（那句是跨书专用的）', async () => {
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).not.toContain('全部书籍')
  })

  it('priority 与 name 是编排器预算排序与面板标题用的，别改', () => {
    const builder = new BookContextBuilder()
    expect(builder.name).toBe('book')
    expect(builder.priority).toBe(90)
  })
})

/**
 * 用户想法（note）进提示词
 *
 * 单独一组是因为它本批是缺陷：以前这一层连读都不读 note 那一列，
 * 而界面上「笔记」页与顶栏全局搜索都搜它。
 */
describe('划线里用户自己的想法要进提示词', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    seed()
  })
  afterEach(() => teardownTestDatabase())

  it('只在想法里出现的词也检索得到，并单列一行标明是谁写的', async () => {
    const result = await new BookContextBuilder().build(ctx({ userMessage: '拖延' }))
    expect(result.content).toContain('一切烦恼都来自人际关系')
    expect(result.content).toContain('（我的想法：拖延让我错过每一次表达）')
    // 分行摆：想法不跟摘句粘在同一行
    expect(result.content).toContain('一切烦恼都来自人际关系\n（我的想法：')
  })

  it('没写想法的划线不摆空括号', async () => {
    const result = await new BookContextBuilder().build(ctx({ userMessage: '被别人讨厌' }))
    expect(result.content).toContain('所谓自由就是被别人讨厌')
    expect(result.content).not.toContain('我的想法')
  })

  it('章节名为空时出处退回书名（不摆空方括号）', async () => {
    const result = await new BookContextBuilder().build(ctx({ userMessage: '被别人讨厌' }))
    expect(result.content).toContain('[被讨厌的勇气] 所谓自由就是被别人讨厌')
  })

  it('有章节名时用章节名（那才是"回到那一章"的线索）', async () => {
    const result = await new BookContextBuilder().build(ctx({ userMessage: '拖延' }))
    expect(result.content).toContain('[第二夜] 一切烦恼都来自人际关系')
  })

  it('与全局搜索对账：只在想法里的那个词，两边召回到同一条划线', async () => {
    const hits = globalSearch('拖延').groups.find((g) => g.kind === 'highlight')?.hits ?? []
    expect(hits.map((h) => h.id)).toContain('h1')
    const result = await new BookContextBuilder().build(ctx({ userMessage: '拖延' }))
    expect(sourcesOf(result).map((s) => s.highlightId)).toContain('h1')
  })

  it('反证：把那条想法从库里抹掉，同一个词就什么都检索不到（命中确实来自 note 这一列）', async () => {
    getDatabase().run("UPDATE highlights SET note = NULL WHERE id = 'h1'")
    invalidateRetrievalIndex()
    const result = await new BookContextBuilder().build(ctx({ userMessage: '拖延' }))
    expect(result.content).not.toContain('## 阅读笔记')
    // 而摘要层不受影响：这条判据顺带证明"没搜到划线"不等于"整轮空了"
    expect(result.content).toContain('【全书】')
    expect(result.metadata?.itemCount).toBe(1)
  })
})

/**
 * 两层各自的失败（本批修复②）
 *
 * 以前 `retrieveHighlights` 在 `rag-service` 里被 catch 咽掉，于是这一层的 catch
 * 从来没机会因"读库失败"而触发 —— 面板把「读取失败」说成「无命中」。
 */
describe('一层坏了不许把另一层带走', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    seed()
  })
  afterEach(() => teardownTestDatabase())

  it('划线读库炸了：摘要层照样带，且原因记进 metadata.error', async () => {
    const spy = vi.spyOn(highlightsDb, 'getAll').mockImplementation(() => {
      throw new Error('划线库读不动')
    })
    const result = await new BookContextBuilder().build(ctx())
    spy.mockRestore()

    expect(result.content).toContain('## 书籍摘要')
    expect(result.content).toContain('【全书】全书讲课题分离的展开')
    expect(result.content).not.toContain('## 阅读笔记')
    expect(result.metadata?.error).toBe('划线库读不动')
    expect(result.metadata?.itemCount).toBe(4)
    expect(logger.error).toHaveBeenCalled()
  })

  it('摘要层读库炸了：划线照样带，只降级摘要（那一层本来就写明是锦上添花）', async () => {
    const spy = vi.spyOn(chapterSummariesDb, 'getByBookId').mockImplementation(() => {
      throw new Error('摘要表读不动')
    })
    const result = await new BookContextBuilder().build(ctx())
    spy.mockRestore()

    expect(result.content).toContain('## 阅读笔记')
    expect(result.content).toContain('课题分离的实践方法')
    expect(result.content).not.toContain('## 书籍摘要')
    expect(result.metadata?.error).toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('划线炸了而库里本来就什么都没有：content 空串，但 error 说得出原因', async () => {
    getDatabase().run('DELETE FROM chapter_summaries')
    getDatabase().run('DELETE FROM book_summaries')
    invalidateRetrievalIndex()
    const spy = vi.spyOn(highlightsDb, 'getAll').mockImplementation(() => {
      throw new Error('炸了')
    })
    const result = await new BookContextBuilder().build(ctx())
    spy.mockRestore()

    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
    expect(result.metadata?.error).toBe('炸了')
  })

  it('什么都没命中时不摆 error 键（"没有"与"读不到"是两件事）', async () => {
    const result = await new BookContextBuilder().build(
      ctx({ bookId: undefined, userMessage: '量子纠缠的数学基础' }),
    )
    expect(result.content).toBe('')
    expect('error' in (result.metadata ?? {})).toBe(false)
  })

  it('选了书、一章都没命中时全书摘要照样带（那是设计，不是"这轮空了"）', async () => {
    const result = await new BookContextBuilder().build(
      ctx({ userMessage: '量子纠缠的数学基础' }),
    )
    expect(result.content).toContain('【全书】全书讲课题分离的展开')
    expect(result.content).not.toContain('## 阅读笔记')
    expect(result.metadata?.itemCount).toBe(1)
  })
})

/** 报的数、摆的预览、交出的引用来源必须同一批 */
describe('metadata 的数与预览同源', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    seed()
  })
  afterEach(() => teardownTestDatabase())

  it('itemCount 与 previews 是同一批（全书摘要 + 3 章 + 1 条划线）', async () => {
    const result = await new BookContextBuilder().build(ctx())
    expect(result.metadata?.itemCount).toBe(5)
    expect(previewsOf(result)).toHaveLength(5)
    expect(result.metadata?.source).toBe('rag')
    expect(result.metadata?.method).toBe('local')
  })

  it('命中 6 条划线时：上限截到 5、预览只摆 3 条，而 itemCount 报的是给了几条', async () => {
    for (let i = 0; i < 5; i++) {
      highlightsDb.create({
        id: `m${i}`,
        book_id: 'b1',
        content: `课题分离的补充笔记${i}`,
      } as never)
    }
    // 语料里得有足够的"不相关"行，否则 BM25 的噪声闸会把这个词整段丢掉
    for (let i = 0; i < 7; i++) {
      highlightsDb.create({
        id: `u${i}`,
        book_id: 'b1',
        content: `与本题无关的第七条备注${i}`,
      } as never)
    }
    invalidateRetrievalIndex()
    const result = await new BookContextBuilder().build(ctx())
    const previews = previewsOf(result)
    expect(sourcesOf(result)).toHaveLength(5)
    expect(result.metadata?.itemCount).toBe(9)
    expect(previews).toHaveLength(7)
    expect(previews[0].title).toBe('全书摘要')
  })

  it('预览正文超 60 字就截断，不超就原样', async () => {
    highlightsDb.create({ id: 'hlong', book_id: 'b1', content: `课题分离${'了'.repeat(80)}` } as never)
    invalidateRetrievalIndex()
    const result = await new BookContextBuilder().build(ctx())
    const previews = previewsOf(result)
    // 声明里 title/snippet 是可选的（构建器实际每条都写），取用时按"缺了就当空串"读，
    // 断言仍逐字对 —— 少了 snippet 这条会红在期望值上，不会被 ?? '' 掩护住。
    const long = previews.find((p) => (p.snippet ?? '').startsWith('课题分离了'))
    expect(long?.snippet).toBe(`课题分离${'了'.repeat(56)}…`)
    expect(long?.snippet).toHaveLength(61)
    expect(previews.every((p) => (p.snippet ?? '').length <= 61)).toBe(true)
  })

  it('引用来源只带能定位回原文的那几条（有 highlightId 也有 bookId）', async () => {
    const result = await new BookContextBuilder().build(ctx())
    const sources = sourcesOf(result)
    expect(sources).toHaveLength(1)
    expect(sources[0].highlightId).toBe('h3')
    expect(sources[0].bookId).toBe('b1')
    expect(sources[0].bookTitle).toBe('被讨厌的勇气')
    expect(sources[0].chapterTitle).toBe('第三夜')
    expect(sources[0].content).toBe('课题分离的实践方法')
    expect(typeof sources[0].relevanceScore).toBe('number')
  })

  it('全书摘要只有空格时三处口径一致：不注入、不报数、不摆预览', async () => {
    // 生产里这条摘要由 AI 产出后原样入库（chapter-summary-service 不 trim），
    // 一个只有空格的返回就这么进库了
    getDatabase().run("UPDATE book_summaries SET summary = '   ' WHERE book_id = 'b1'")
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).not.toContain('【全书】')
    expect(previewsOf(result).map((p) => p.title)).toEqual([
      '第01章',
      '第02章',
      '第03章',
      '第三夜',
    ])
    expect(result.metadata?.itemCount).toBe(4)
  })

  it('反证：上一条不是空转（把摘要换成有内容，那一行与那条数就都回来了）', async () => {
    getDatabase().run("UPDATE book_summaries SET summary = '全书讲课题分离' WHERE book_id = 'b1'")
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).toContain('【全书】全书讲课题分离')
    expect(result.metadata?.itemCount).toBe(5)
  })

  it('一本书没有任何摘要时只带划线（不摆空的摘要标题）', async () => {
    getDatabase().run('DELETE FROM chapter_summaries')
    getDatabase().run('DELETE FROM book_summaries')
    const result = await new BookContextBuilder().build(ctx())
    expect(result.content).not.toContain('## 书籍摘要')
    expect(result.content).toContain('## 阅读笔记')
    expect(result.metadata?.itemCount).toBe(1)
  })
})

/**
 * 失败不再被下游演成"没有数据"（源码扫描，尺子伸到 services 那一层）
 *
 * 上一批把"每个 catch 都要把消息交出去"立成了构建器层的常驻扫描，但那一把尺
 * 扫不到 service：`rag-service` 在构建器的 catch **下面**，它自己咽掉就什么都扫不到。
 */
describe('检索适配层不许把失败演成空结果（源码扫描）', () => {
  const read = (relative: string) =>
    readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n')

  it('retrieveHighlights 里没有"catch 之后回空数组"那种写法', () => {
    expect(read('electron/services/rag-service.ts')).not.toMatch(/catch[\s\S]{0,160}return \[\]/)
  })

  it('反证：收口前那一份必须被这条扫描判红', () => {
    const before = [
      '  try {',
      '    const index = getIndex()',
      '    return hits',
      '  } catch (error) {',
      "    logger.error('本地检索失败', { error: String(error) })",
      '    return []',
      '  }',
    ].join('\n')
    expect(before).toMatch(/catch[\s\S]{0,160}return \[\]/)
  })

  it('构建器那边：划线层的失败带 error，摘要层的内层 catch 只降级（豁免理由仍成立）', () => {
    const src = read('electron/agent/builders/book-context-builder.ts')
    const catches = (src.match(/catch \(error\) \{/g) ?? []).length
    const reported = (src.match(/error instanceof Error/g) ?? []).length
    expect(catches).toBe(reported + 1)
    expect(src).toContain("logger.warn('章节摘要读取失败")
  })
})
