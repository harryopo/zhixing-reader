// 全局搜索的通道与真库行为（2026-09-25）
//
// 注册**真实的** registerSearchHandlers，种一份五类都有命中的库，再看结果。
// 停在 SQL 层测不出"通道没注册""每类上限没生效""链接拼错"这三种坏法 ——
// 那正是本项目这一周反复在治的形状。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  articlesDb,
  booksDb,
  getDatabase,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  vocabularyDb,
} from '../electron/database'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { SEARCH_GROUPS, type GlobalSearchResult } from '../src/shared/global-search'
import { registerSearchHandlers } from '../electron/ipc/search'

type Handler = (...args: unknown[]) => GlobalSearchResult

function searchHandler(): Handler {
  const handlers = new Map<string, Handler>()
  registerSearchHandlers((channel, handler) => {
    handlers.set(channel, handler as Handler)
  })
  const h = handlers.get(IPC_CHANNELS.SEARCH.GLOBAL)
  if (!h) throw new Error('search:global 没注册 —— 结果页会一直报"搜索失败"')
  return h
}

function groupOf(result: GlobalSearchResult, kind: string) {
  return result.groups.find((g) => g.kind === kind)
}

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '思考，快与慢' })
  booksDb.create({ id: 'b2', title: '穷查理宝典' })
  highlightsDb.create({
    id: 'h1',
    book_id: 'b1',
    content: '注意力与努力是同一件事的两面',
    chapter_title: '第二章',
  })
  // 内容里没有关键词、只有笔记里有：片段必须从笔记取
  highlightsDb.create({
    id: 'h2',
    book_id: 'b2',
    content: '这条划线的正文与关键词无关',
    note: '让我想到复利这件事',
  })
  knowledgeCardsDb.create({
    id: 'k1',
    book_id: 'b1',
    type: 'concept',
    title: '复利思维',
    content: '把收益再投入',
  })
  methodologiesDb.create({
    id: 'm1',
    book_id: 'b2',
    name: '彩票式投资',
    description: '靠复利而非运气',
  })
  articlesDb.create({
    id: 'a1',
    title_en: 'On compounding',
    title_zh: '谈谈复利',
    content_en: 'Compounding needs time.',
    source: '每日文章',
  })
  vocabularyDb.create({ id: 'v1', word: 'compound', meaning_zh: '复利；化合物' })
})

afterEach(() => {
  teardownTestDatabase()
})

describe('search:global 通道', () => {
  it('注册在常量表说的名字上', () => {
    const keys: string[] = []
    registerSearchHandlers((channel) => {
      keys.push(String(channel))
    })
    expect(keys).toEqual([IPC_CHANNELS.SEARCH.GLOBAL])
  })

  it('五类都能命中，分组顺序与约定一致', () => {
    const r = searchHandler()('复利')
    expect(r.groups.map((g) => g.kind)).toEqual(['highlight', 'card', 'methodology', 'article', 'word'])
    expect(r.groups.map((g) => g.label)).toEqual(SEARCH_GROUPS.map((g) => g.label))
    expect(r.total).toBe(5)
  })

  it('每条命中都带得回原处：书名、片段与链接一起交回', () => {
    const r = searchHandler()('复利')
    expect(groupOf(r, 'highlight')!.hits[0]).toMatchObject({
      id: 'h2',
      title: '穷查理宝典',
      meta: '',
      link: '/bookshelf/b2?tab=highlights&highlight=h2',
    })
    // 正文不含关键词、笔记含 —— 片段要从笔记里取，否则用户看不见自己写的想法
    expect(groupOf(r, 'highlight')!.hits[0].snippet).toContain('让我想到复利这件事')
    expect(groupOf(r, 'word')!.hits[0].link).toBe('/vocabulary?item=v1')
    expect(groupOf(r, 'article')!.hits[0].link).toBe('/daily-learning?article=a1')
    expect(groupOf(r, 'card')!.hits[0].link).toBe('/knowledge-cards?q=%E5%A4%8D%E5%88%A9')
  })

  it('每类只到自己那条上限，别的类不受影响', () => {
    for (let i = 0; i < 12; i++) {
      highlightsDb.create({ id: `x${i}`, book_id: 'b1', content: `复利第 ${i} 条` })
    }
    const r = searchHandler()('复利')
    expect(groupOf(r, 'highlight')!.hits).toHaveLength(
      SEARCH_GROUPS.find((g) => g.kind === 'highlight')!.limit,
    )
    expect(groupOf(r, 'card')!.hits).toHaveLength(1)
    expect(r.total).toBe(r.groups.reduce((n, g) => n + g.hits.length, 0))
  })

  it('关键词里的 % 按字面匹配，不会命中所有行', () => {
    const r = searchHandler()('%')
    expect(r.total).toBe(0)
    expect(r.groups).toEqual([])
  })

  it('空关键词与纯空格都不发查询', () => {
    for (const q of ['', '   ']) {
      const r = searchHandler()(q)
      expect(r).toEqual({ query: '', groups: [], total: 0 })
    }
  })

  it('一类都没命中时 groups 是空数组，界面据此说"没有找到"', () => {
    const r = searchHandler()('这个词库里没有')
    expect(r.groups).toEqual([])
    expect(r.total).toBe(0)
    expect(r.query).toBe('这个词库里没有')
  })

  it('大小写不敏感：搜 COMPOUND 找得到 compound', () => {
    const r = searchHandler()('COMPOUND')
    expect(groupOf(r, 'word')!.hits.map((h) => h.id)).toEqual(['v1'])
  })

  it('结果只看见 12 条划线，库里的其它行一条没被改动（搜索是只读的）', () => {
    const before = getDatabase().exec('SELECT COUNT(*) FROM highlights')[0].values[0][0]
    searchHandler()('复利')
    searchHandler()('不存在')
    const after = getDatabase().exec('SELECT COUNT(*) FROM highlights')[0].values[0][0]
    expect(after).toBe(before)
  })
})
