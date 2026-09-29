// tests/rag-service.test.ts
//
// 检索适配层（electron/services/rag-service.ts）的集成测试。
//
// 这个文件守四件事：
//   1. 从真实数据库读出来的划线能被中文问题检索到（含书名）
//   2. 索引会随数据变化自动失效重建（签名机制）—— 否则用户新导入的划线永远搜不到
//   3. 用户自己写的想法（note）参与检索：全局搜索与笔记页都搜它，AI 那台以前不搜
//   4. 读库失败要抛出去：这层以前 catch 回空数组，于是"读不到"与"没命中"交回的结果
//      一字不差，对话面板只能说「无命中」——一句关于用户数据库的假话

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, getDatabase, highlightsDb } from '../electron/database'

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../electron/logger', () => ({ logger }))

import { retrieveHighlights, invalidateRetrievalIndex } from '../electron/services/rag-service'

function seed() {
  booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
  booksDb.create({ id: 'b2', title: '掌控习惯' } as never)
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系' } as never)
  highlightsDb.create({ id: 'h2', book_id: 'b1', content: '所谓自由就是被别人讨厌' } as never)
  highlightsDb.create({ id: 'h3', book_id: 'b2', content: '习惯的养成需要环境设计' } as never)
}

describe('retrieveHighlights - 索引适配层', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    seed()
  })
  afterEach(() => teardownTestDatabase())

  it('中文提问命中中文划线，且带上书名', async () => {
    const hits = await retrieveHighlights('人际关系为什么会让人烦恼', { bookId: 'b1' })
    expect(hits[0].highlightId).toBe('h1')
    expect(hits[0].bookTitle).toBe('被讨厌的勇气')
  })

  it('不传 bookId 时跨书检索', async () => {
    const hits = await retrieveHighlights('习惯养成')
    expect(hits[0].highlightId).toBe('h3')
  })

  it('无关问题返回空数组', async () => {
    expect(await retrieveHighlights('量子纠缠的数学基础')).toEqual([])
  })

  it('新增划线后索引自动失效重建（签名变化）', async () => {
    // 用一个原本不存在的词，避免"其实早就搜得到"的假测试
    expect(await retrieveHighlights('复盘方法')).toEqual([])
    highlightsDb.create({ id: 'h4', book_id: 'b2', content: '复盘方法决定成长速度' } as never)
    const hits = await retrieveHighlights('复盘方法')
    expect(hits[0].highlightId).toBe('h4')
  })

  it('同一秒内改章节名也会让索引失效（updated_at 精度只到秒，靠写计数器兜底）', () => {
    const before = highlightsDb.getRetrievalSignature()
    highlightsDb.updateChapterTitles([{ id: 'h1', chapterTitle: '第一章 人际关系' }])
    expect(highlightsDb.getRetrievalSignature()).not.toBe(before)
  })

  it('章节名回填后，用章节名里的词也能搜到那条划线', async () => {
    expect(await retrieveHighlights('认知失调')).toEqual([])
    highlightsDb.updateChapterTitles([{ id: 'h1', chapterTitle: '第三章 认知失调' }])
    const hits = await retrieveHighlights('认知失调')
    expect(hits[0].highlightId).toBe('h1')
  })

  it('limit 生效', async () => {
    const hits = await retrieveHighlights('人际关系 自由 讨厌', { limit: 1 })
    expect(hits).toHaveLength(1)
  })
})

/**
 * 用户自己写的想法（note）参与检索（2026-09-29 新增）。
 *
 * 病是读代码读出来的：全局搜索那台 `likeColumns` 有 `h.note`、笔记页那台筛选器的字段清单
 * 也有 `note`，而这一层建索引只喂 `content` ⇒ 同一个关键词，搜索页说"找到了这条划线"，
 * AI 手里却根本没有它。这是"三台筛选器各说各话"的第三次（前两次：卡片与方法论的字段清单、
 * 记忆检索的 LIKE 转义）。
 */
describe('划线里的用户想法（note）也参与检索', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    booksDb.create({ id: 'b2', title: '掌控习惯' } as never)
    // 想法挂在另一条划线上：正文里没有「拖延」，只有用户自己的想法里有
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系' } as never)
    highlightsDb.create({
      id: 'h2',
      book_id: 'b1',
      content: '所谓自由就是被别人讨厌',
      note: '拖延让我错过每一次表达',
    } as never)
    highlightsDb.create({ id: 'h3', book_id: 'b2', content: '习惯的养成需要环境设计' } as never)
  })
  afterEach(() => teardownTestDatabase())

  it('只在想法里出现的词也检索得到，且交回的行带着那条想法', async () => {
    const hits = await retrieveHighlights('拖延')
    expect(hits.map((h) => h.highlightId)).toEqual(['h2'])
    expect(hits[0].note).toBe('拖延让我错过每一次表达')
  })

  it('想法不与正文混成一坨：content 仍是书里那句（模型要分得清谁说的）', async () => {
    const hits = await retrieveHighlights('拖延')
    expect(hits[0].content).toBe('所谓自由就是被别人讨厌')
    expect(hits[0].content).not.toContain('拖延')
  })

  it('没写过想法的划线交回的是"没有这条"（undefined），不是编出来的空串', async () => {
    const hits = await retrieveHighlights('人际关系')
    expect(hits[0].highlightId).toBe('h1')
    expect(hits[0].note).toBeUndefined()
  })

  it('反证：把那条想法抹掉，同一个词就一条都搜不到（证明上两条命中来自 note 这一列）', async () => {
    getDatabase().run("UPDATE highlights SET note = NULL WHERE id = 'h2'")
    invalidateRetrievalIndex()
    expect(await retrieveHighlights('拖延')).toEqual([])
    // 而正文还在：那条划线仍能被正文里的词搜到（不是"整条消失了"那种假绿）
    expect(await retrieveHighlights('被别人讨厌')).toHaveLength(1)
  })

  it('正文与想法同时命中时，想法里的词也计入打分（同一条不会因长度翻倍被挤掉）', async () => {
    const hits = await retrieveHighlights('被别人讨厌 拖延')
    expect(hits[0].highlightId).toBe('h2')
  })
})

/**
 * 读库失败要抛出去（2026-09-29 新增）
 *
 * 这一层以前是 `catch { logger.error; return [] }` —— 于是"库里读不出来"与
 * "这个问题确实搜不到东西"交回的结果一字不差。而唯一的调用方（书籍上下文构建器）
 * 自己有一层 catch 会把消息记进 `metadata.error`，对话面板据此才说得出「读取失败」。
 * 这一层吞掉，面板就只能对用户说「无命中」：一句关于他自己数据库的假话。
 */
describe('读库失败不许被演成"没有命中"', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系' } as never)
  })
  afterEach(() => teardownTestDatabase())
  // 抛错型 spy 一律在 afterEach 里还原：写在断言之后，一旦那条断言先红，
  // 这只"会抛的 getAll"就漏给后面每一个用例（本批做变异时真踩过 —— 后面五个用例
  // 跟着红，红的却不是同一个原因，读起来像代码坏了）。
  afterEach(() => vi.restoreAllMocks())

  it('getAll 抛错时，这条 Promise 以原因为由 reject（而不是回一个空数组）', async () => {
    vi.spyOn(highlightsDb, 'getAll').mockImplementation(() => {
      throw new Error('划线库读不动')
    })
    await expect(retrieveHighlights('人际关系')).rejects.toThrow('划线库读不动')
  })

  it('签名那一环抛错也一样抛出去（读不出来就别猜"没数据"）', async () => {
    vi.spyOn(highlightsDb, 'getRetrievalSignature').mockImplementation(() => {
      throw new Error('签名读不出')
    })
    await expect(retrieveHighlights('人际关系')).rejects.toThrow('签名读不出')
  })

  it('抛出去就抛出去：这一层不再自己记"本轮不带书籍上下文"那种结论', async () => {
    vi.spyOn(highlightsDb, 'getAll').mockImplementation(() => {
      throw new Error('读不动')
    })
    await expect(retrieveHighlights('人际关系')).rejects.toThrow()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('正例：库里读得动时照常返回命中，且上面那三条不是空转', async () => {
    const hits = await retrieveHighlights('人际关系')
    expect(hits[0].highlightId).toBe('h1')
  })

  it('真的没命中时交回空数组，且不带任何错误形状（与"读不到"分得开）', async () => {
    expect(await retrieveHighlights('量子纠缠的数学基础')).toEqual([])
  })
})

/** 索引缓存：同一份数据只建一次（重建靠签名，不是每次查询都重读整库） */
describe('索引缓存与重建次数', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    invalidateRetrievalIndex()
    vi.clearAllMocks()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系' } as never)
  })
  afterEach(() => teardownTestDatabase())

  it('连着问三次只建一次索引（签名没变就走缓存）', async () => {
    await retrieveHighlights('人际关系')
    await retrieveHighlights('自由')
    await retrieveHighlights('讨厌')
    const rebuilds = logger.info.mock.calls.filter(
      (call) => call[0] === '检索索引已重建',
    )
    expect(rebuilds).toHaveLength(1)
  })

  it('数据一变，下一次查询就重建（用户新导入的划线不能搜不到）', async () => {
    await retrieveHighlights('人际关系')
    highlightsDb.create({ id: 'h9', book_id: 'b1', content: '课题分离不是冷淡' } as never)
    await retrieveHighlights('课题分离')
    const rebuilds = logger.info.mock.calls.filter((call) => call[0] === '检索索引已重建')
    expect(rebuilds).toHaveLength(2)
  })

  it('手动失效后重建一次（测试隔离用的那条通路真的在起作用）', async () => {
    await retrieveHighlights('人际关系')
    invalidateRetrievalIndex()
    await retrieveHighlights('人际关系')
    const rebuilds = logger.info.mock.calls.filter((call) => call[0] === '检索索引已重建')
    expect(rebuilds).toHaveLength(2)
  })

  it('库里一条划线都没有时不抛，交回空数组（空索引也是一次正常的重建）', async () => {
    getDatabase().run('DELETE FROM highlights')
    invalidateRetrievalIndex()
    expect(await retrieveHighlights('人际关系')).toEqual([])
    expect(logger.info.mock.calls.filter((call) => call[0] === '检索索引已重建')).toHaveLength(1)
  })
})
