/**
 * 知识卡片 / 方法论两个上下文构建器的判据（真库）
 *
 * 为什么是真库而不是 mock：这两层唯一的下游就是 `electron/database` 那两条读口，
 * 而本批要回答的问题恰好是「那一行读出来到底有没有 book_title」「渲染出来的每一栏
 * 是不是库里那一行的值」—— mock 只能证明"服务按 mock 的返回值算数"。
 * logger 是这一层另一个外圈，照常 mock。
 *
 * 本批（2026-09-29）量出来并修掉的三条（各有一条判据，不是顺手补的绿灯）：
 *   1. 方法论那一路把 `bookTitle` 写死成空串 ⇒ 问「《某本书》里的方法论」时那一路检索不到，
 *      而搜索页与方法论页都能按书名筛到同一条（三台筛选器两种答法，谁都不报错）。
 *   2. `output_format`（AI 提取时专门产出的"这个方法论产出什么"）既不参与打分，
 *      也不在注入文本里 —— 模型永远看不到它。
 *   3. 卡片与方法论注入给模型的文本都不带书名 ⇒ 跨书检索时模型说不出出处；
 *      而 `getByBookId` 是裸 `SELECT *`（没有 book_title 这一列）、`getAll` 才 JOIN 出来，
 *      两条读路形状不同，选了书那半边连想带都带不出来。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  getDatabase,
  booksDb,
  knowledgeCardsDb,
  methodologiesDb,
} from '../electron/database'
import { MethodologyContextBuilder } from '../electron/agent/builders/methodology-context-builder'
import { KnowledgeCardContextBuilder } from '../electron/agent/builders/knowledge-card-context-builder'
import { globalSearch } from '../electron/services/global-search'
import type { BuildContext } from '../electron/agent/context-builder'

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf-8').replace(/\r\n/g, '\n')

const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  sessionId: 's1',
  bookId: 'b1',
  userMessage: '课题分离是什么意思',
  conversationHistory: [],
  intent: 'knowledge_query',
  ...overrides,
})

/** 全局搜索某一类命中的 id —— 与构建器交回的那批对账 */
const searchIds = (query: string, kind: 'card' | 'methodology'): string[] => {
  const group = globalSearch(query).groups.find((g) => g.kind === kind)
  return group ? group.hits.map((h) => h.id) : []
}

const methodName = '课题分离'

const methodFeynman = {
  id: 'm1',
  book_id: 'b1',
  name: methodName,
  name_en: 'Separation of Tasks',
  trigger_scenario: '为别人的评价烦恼时',
  description: '把别人的课题还给别人',
  steps: ['分清是谁的课题', '只做自己的', '不干涉他人'],
  output_format: '一句话结论',
  examples: '孩子学不学习是孩子的课题',
  mastery_level: 40,
}

/** 另一本书（《量子力学讲义》）上的方法论：与 m1 没有任何共用词，方便做逐词对账 */
const methodQuantum = {
  id: 'm9',
  book_id: 'b2',
  name: '测不准的直觉',
  description: '测量本身会改变结果',
  steps: ['准备态', '做测量', '记录分布'],
  output_format: '一张谱表',
  examples: '电子双缝',
  mastery_level: 0,
}

const cardConcept = {
  id: 'kc1',
  book_id: 'b1',
  type: 'concept',
  title: methodName,
  content: '把别人的课题还给别人',
  interpretation: '烦恼来自干涉他人的课题',
  application: '每天问一次这是谁的课题',
}

const cardAmplitude = {
  id: 'kc2',
  book_id: 'b2',
  type: 'concept',
  title: '概率幅',
  content: '每条路径都有一个幅',
  interpretation: '幅的平方才是概率',
  application: '先把所有路径的幅加起来',
}

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
  booksDb.create({ id: 'b2', title: '量子力学讲义' } as never)
})

afterEach(() => {
  teardownTestDatabase()
})

describe('两条读路交回的行形状必须一样（book_title 都在）', () => {
  it('方法论：按书取与全量取都带书名', () => {
    methodologiesDb.create(methodFeynman)
    const byBook = methodologiesDb.getByBookId('b1')[0] as Record<string, unknown>
    const all = methodologiesDb.getAll()[0] as Record<string, unknown>
    expect(byBook.book_title).toBe('被讨厌的勇气')
    expect(all.book_title).toBe('被讨厌的勇气')
  })

  it('知识卡片：按书取与全量取都带书名', () => {
    knowledgeCardsDb.create(cardConcept)
    const byBook = knowledgeCardsDb.getByBookId('b1')[0] as Record<string, unknown>
    const all = knowledgeCardsDb.getAll()[0] as Record<string, unknown>
    expect(byBook.book_title).toBe('被讨厌的勇气')
    expect(all.book_title).toBe('被讨厌的勇气')
  })

  it('反证：书名来自 JOIN，裸 SELECT 那一行确实没有这一列（不是构建器编的）', () => {
    methodologiesDb.create(methodFeynman)
    const res = getDatabase().exec('SELECT * FROM methodologies WHERE id = ?', ['m1'])
    const bare = res[0].values[0].reduce<Record<string, unknown>>((acc, v, i) => {
      acc[res[0].columns[i]] = v
      return acc
    }, {})
    expect(bare.book_title).toBeUndefined()
    expect(bare.name).toBe(methodName)
  })
})

describe('MethodologyContextBuilder（真库）', () => {
  const builder = new MethodologyContextBuilder()

  it('库里没有方法论：空 content、itemCount 0、method=relevance', () => {
    const result = builder.build(ctx())
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
    expect(result.metadata?.method).toBe('relevance')
  })

  it('有方法论但关键词一个都不命中：不注入（不按库顺序硬塞 5 条）', () => {
    methodologiesDb.create(methodFeynman)
    const result = builder.build(ctx({ userMessage: '今天天气怎么样' }))
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
  })

  it('命中那条逐栏对账：每一栏都是库里那一行的值', () => {
    methodologiesDb.create(methodFeynman)
    const { content, metadata } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(content).toContain('【课题分离】 (Separation of Tasks)')
    expect(content).toContain('来源:《被讨厌的勇气》')
    expect(content).toContain('触发场景: 为别人的评价烦恼时')
    expect(content).toContain('描述: 把别人的课题还给别人')
    expect(content).toContain('步骤: 分清是谁的课题 → 只做自己的 → 不干涉他人')
    expect(content).toContain('输出格式: 一句话结论')
    expect(content).toContain('示例: 孩子学不学习是孩子的课题')
    expect(content).toContain('掌握度: 40%')
    expect(metadata?.itemCount).toBe(1)
  })

  it('掌握度 0 时不摆那一行（0 不是信息，只是给模型看的噪音）', () => {
    methodologiesDb.create({ ...methodFeynman, mastery_level: 0 })
    const { content } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(content).not.toContain('掌握度')
  })

  it('没选书：末尾说清范围；选了书：不写那句（范围已由 bookId 限定）', () => {
    methodologiesDb.create(methodFeynman)
    const cross = builder.build(ctx({ bookId: undefined, userMessage: '课题分离怎么做' }))
    expect(cross.content).toContain('从你的全部书籍的方法论中检索出来的')
    const scoped = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(scoped.content).not.toContain('全部书籍')
    expect(scoped.content).toContain('来源:《被讨厌的勇气》')
  })

  it('选了书就只带那一本的方法论', () => {
    methodologiesDb.create(methodFeynman)
    methodologiesDb.create(methodQuantum)
    const { content, metadata } = builder.build(ctx({ bookId: 'b2', userMessage: '测不准的直觉' }))
    expect(content).toContain('【测不准的直觉】')
    expect(content).not.toContain('【课题分离】')
    expect(metadata?.itemCount).toBe(1)
  })

  it('steps 是合法 JSON 但不是数组 ⇒ 跳过步骤行，其余照常', () => {
    methodologiesDb.create({ ...methodFeynman, steps: { 第一步: '分清课题' } })
    const { content } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(content).not.toContain('步骤: ')
    expect(content).toContain('输出格式: 一句话结论')
  })

  it('steps 是空数组 ⇒ 也不摆步骤那一行', () => {
    methodologiesDb.create({ ...methodFeynman, steps: [] })
    const { content } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(content).not.toContain('步骤: ')
  })

  it('steps 列里是坏 JSON（只能由直接写库造成）⇒ 只丢那一栏，整条照样注入', () => {
    methodologiesDb.create(methodFeynman)
    getDatabase().run(`UPDATE methodologies SET steps = '{这不是 JSON' WHERE id = 'm1'`)
    const { content } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(content).toContain('【课题分离】')
    expect(content).not.toContain('步骤: ')
  })

  it('只有输出格式命中的那条，也检索得出来（此前这一栏不参与打分）', () => {
    methodologiesDb.create({ ...methodFeynman, output_format: '任务清单' })
    const { content, metadata } = builder.build(ctx({ bookId: undefined, userMessage: '任务清单' }))
    expect(content).toContain('【课题分离】')
    expect(metadata?.itemCount).toBe(1)
  })

  it('只有书名命中的那条，也检索得出来（此前 bookTitle 被写死成空串）', () => {
    methodologiesDb.create(methodQuantum)
    const { content } = builder.build(ctx({ bookId: undefined, userMessage: '量子力学' }))
    expect(content).toContain('【测不准的直觉】')
  })

  /*
    夹具说明（第一次踩到才写下来）：BM25 那台会把"人人都有的词"当噪声整段丢掉
    （df/docCount > 0.5 就不参与打分）。所以这里不能造 5 条同名方法论去查那个名字 ——
    那会一条都不命中，测试绿得像"检索坏了"。语料 8 条、查询词只出现在其中 3 条，
    才是"确实命中 3 条"的形状。
  */
  it('previews 最多三条、与 itemCount 同一批；摘要 60 字两头都钉', () => {
    const hits = [
      { id: 'pa', name: '丙丁甲', description: 'X'.repeat(60) },
      { id: 'pb', name: '丙丁乙', description: 'Y'.repeat(80) },
      { id: 'pc', name: '丙丁丙', description: 'Z'.repeat(30) },
    ]
    for (const h of hits) methodologiesDb.create({ ...methodFeynman, ...h })
    for (let i = 0; i < 5; i++) {
      methodologiesDb.create({ ...methodQuantum, id: 'q' + i, name: '庚辛' + i })
    }
    const { content, metadata } = builder.build(ctx({ bookId: undefined, userMessage: '丙丁' }))
    const previews = metadata?.previews ?? []
    expect(metadata?.itemCount).toBe(3)
    expect(previews).toHaveLength(3)
    expect(previews.every((p) => String(p.title).startsWith('丙丁'))).toBe(true)
    expect(previews.find((p) => p.title === '丙丁乙')?.snippet).toBe('Y'.repeat(60) + '…')
    expect(previews.find((p) => p.title === '丙丁甲')?.snippet).toBe('X'.repeat(60))
    expect(previews.find((p) => p.title === '丙丁丙')?.snippet).toBe('Z'.repeat(30))
    expect(content).toContain('【丙丁甲】')
  })

  it('description 为空时预览交回空串，不编内容', () => {
    methodologiesDb.create({ ...methodFeynman, description: undefined })
    const { metadata } = builder.build(ctx({ userMessage: '课题分离怎么做' }))
    expect(metadata?.previews?.[0]).toEqual({ title: methodName, snippet: '' })
  })

  it('书名是空串时不摆一对空《》（库里 NOT NULL 允许空值）', () => {
    booksDb.create({ id: 'b3', title: '' } as never)
    methodologiesDb.create({ ...methodFeynman, id: 'm3', book_id: 'b3' })
    const { content } = builder.build(ctx({ bookId: 'b3', userMessage: '课题分离怎么做' }))
    expect(content).toContain('【课题分离】')
    expect(content).not.toContain('来源:')
    expect(content).not.toContain('《》')
  })

  it('读库抛错：content 交回空串、优先级不变、错误写进 metadata.error', () => {
    const spy = vi.spyOn(methodologiesDb, 'getAll').mockImplementationOnce(() => {
      throw new Error('库炸了')
    })
    const result = new MethodologyContextBuilder().build(ctx({ bookId: undefined }))
    expect(result.content).toBe('')
    expect(result.priority).toBe(80)
    expect(result.metadata?.error).toBe('库炸了')
    spy.mockRestore()
  })

  it('对同一份数据：全局搜索命中的方法论，这一路逐条都注入', () => {
    methodologiesDb.create({ ...methodFeynman, output_format: '任务清单' })
    methodologiesDb.create(methodQuantum)
    for (const query of ['任务清单', '量子力学', '测不准', '电子双缝']) {
      const fromSearch = searchIds(query, 'methodology')
      expect(fromSearch.length, `「${query}」搜索本身就该有命中`).toBeGreaterThan(0)
      const { content } = new MethodologyContextBuilder().build(
        ctx({ bookId: undefined, userMessage: query }),
      )
      const rows = methodologiesDb.getAll() as Array<{ id: string; name: string }>
      for (const id of fromSearch) {
        const row = rows.find((m) => m.id === id)
        expect(content, `「${query}」搜索命中《${row?.name}》，构建器却没注入`).toContain(
          '【' + String(row?.name) + '】',
        )
      }
    }
  })
})

describe('KnowledgeCardContextBuilder（真库）', () => {
  const builder = new KnowledgeCardContextBuilder()

  it('库里没有卡片：空 content、itemCount 0', () => {
    const result = builder.build(ctx())
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
  })

  it('完全不相关时不注入', () => {
    knowledgeCardsDb.create(cardConcept)
    const result = builder.build(ctx({ userMessage: '今天天气怎么样' }))
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
  })

  it('命中那张逐栏对账，并带上《书名》', () => {
    knowledgeCardsDb.create(cardConcept)
    const { content, metadata } = builder.build(ctx({ userMessage: '课题分离是什么意思' }))
    expect(content).toContain('【课题分离】 (concept)')
    expect(content).toContain('来源:《被讨厌的勇气》')
    expect(content).toContain('内容: 把别人的课题还给别人')
    expect(content).toContain('解读: 烦恼来自干涉他人的课题')
    expect(content).toContain('应用: 每天问一次这是谁的课题')
    expect(metadata?.itemCount).toBe(1)
  })

  it('没有解读 / 应用时不摆空行', () => {
    knowledgeCardsDb.create({ ...cardConcept, interpretation: undefined, application: undefined })
    const { content } = builder.build(ctx({ userMessage: '课题分离' }))
    expect(content).toContain('【课题分离】')
    expect(content).not.toContain('解读:')
    expect(content).not.toContain('应用:')
  })

  it('没选书时带书名并说清范围；选了书时不写那句', () => {
    knowledgeCardsDb.create(cardConcept)
    knowledgeCardsDb.create(cardAmplitude)
    const cross = builder.build(ctx({ bookId: undefined, userMessage: '课题分离' }))
    expect(cross.content).toContain('从你的全部书籍的知识卡片中检索出来的')
    const scoped = builder.build(ctx({ userMessage: '课题分离' }))
    expect(scoped.content).not.toContain('全部书籍')
    expect(scoped.content).toContain('来源:《被讨厌的勇气》')
  })

  it('只有书名命中的那张，也检索得出来', () => {
    knowledgeCardsDb.create(cardAmplitude)
    const { content } = builder.build(ctx({ bookId: undefined, userMessage: '量子力学' }))
    expect(content).toContain('【概率幅】')
  })

  it('previews 最多三条，内容 60 字两头都钉', () => {
    const hits = [
      { id: 'ka', title: '丙丁甲', content: 'Y'.repeat(80) },
      { id: 'kb', title: '丙丁乙', content: 'X'.repeat(60) },
      { id: 'kc', title: '丙丁丙', content: 'Z'.repeat(30) },
    ]
    for (const h of hits) knowledgeCardsDb.create({ ...cardConcept, ...h })
    for (let i = 0; i < 5; i++) {
      knowledgeCardsDb.create({ ...cardAmplitude, id: 'z' + i, title: '庚辛' + i })
    }
    const { metadata } = builder.build(ctx({ bookId: undefined, userMessage: '丙丁' }))
    const previews = metadata?.previews ?? []
    expect(metadata?.itemCount).toBe(3)
    expect(previews).toHaveLength(3)
    expect(previews.find((p) => p.title === '丙丁甲')?.snippet).toBe('Y'.repeat(60) + '…')
    expect(previews.find((p) => p.title === '丙丁乙')?.snippet).toBe('X'.repeat(60))
    expect(previews.find((p) => p.title === '丙丁丙')?.snippet).toBe('Z'.repeat(30))
  })

  it('content 是空串时不摆「内容: 」，预览交回空串', () => {
    knowledgeCardsDb.create({ ...cardConcept, content: '' })
    const { content, metadata } = builder.build(ctx({ userMessage: '课题分离' }))
    expect(content).toContain('【课题分离】')
    expect(content).not.toContain('内容: ')
    expect(metadata?.previews?.[0]?.snippet).toBe('')
  })

  it('书名是空串时不摆一对空《》', () => {
    booksDb.create({ id: 'b3', title: '' } as never)
    knowledgeCardsDb.create({ ...cardConcept, id: 'kc3', book_id: 'b3' })
    const { content } = builder.build(ctx({ bookId: 'b3', userMessage: '课题分离' }))
    expect(content).toContain('【课题分离】 (concept)')
    expect(content).not.toContain('来源:')
    expect(content).not.toContain('《》')
  })

  it('读库抛错：交回空串并把错误记进 metadata.error', () => {
    const spy = vi.spyOn(knowledgeCardsDb, 'getAll').mockImplementationOnce(() => {
      throw new Error('卡片库读不动')
    })
    const result = new KnowledgeCardContextBuilder().build(ctx({ bookId: undefined }))
    expect(result.content).toBe('')
    expect(result.priority).toBe(70)
    expect(result.metadata?.error).toBe('卡片库读不动')
    spy.mockRestore()
  })

  it('对同一份数据：全局搜索命中的卡片，这一路逐条都注入', () => {
    knowledgeCardsDb.create(cardConcept)
    knowledgeCardsDb.create(cardAmplitude)
    for (const query of ['量子力学', '概率幅', '干涉']) {
      const fromSearch = searchIds(query, 'card')
      expect(fromSearch.length, `「${query}」搜索本身就该有命中`).toBeGreaterThan(0)
      const { content } = new KnowledgeCardContextBuilder().build(
        ctx({ bookId: undefined, userMessage: query }),
      )
      const rows = knowledgeCardsDb.getAll() as Array<{ id: string; title: string }>
      for (const id of fromSearch) {
        const row = rows.find((c) => c.id === id)
        expect(content, `「${query}」搜索命中《${row?.title}》，构建器却没注入`).toContain(
          '【' + String(row?.title) + '】',
        )
      }
    }
  })
})

/*
  死分支与"两份口径"不许回来：
  - 库里 id 是 PRIMARY KEY、name/title 是 NOT NULL，所以 `?? 'card_' + index` 那种
    按序号编 id 的兜底永远走不到（本项目不留走不到的分支）。
  - 方法论那一路的 `bookTitle: ''` 就是本批第 1 条缺陷的形状。
*/
describe('构建器源码的两条扫描', () => {
  const BUILDERS = [
    'electron/agent/builders/knowledge-card-context-builder.ts',
    'electron/agent/builders/methodology-context-builder.ts',
  ]

  it.each(BUILDERS)('%s 里没有「按序号造 id」的兜底', (file) => {
    expect(read(file)).not.toMatch(/\?\?\s*'(card|methodology)_' \+ index/)
  })

  it('方法论那一路不许再把书名写死成空串', () => {
    expect(read('electron/agent/builders/methodology-context-builder.ts')).not.toMatch(
      /bookTitle:\s*''/
    )
  })

  it('反证：收口前的三种原文都必须被扫描命中（判据不是空转）', () => {
    expect("const id = card.id ?? 'card_' + index").toMatch(/\?\?\s*'(card|methodology)_' \+ index/)
    expect("const id = m.id ?? 'methodology_' + index").toMatch(
      /\?\?\s*'(card|methodology)_' \+ index/
    )
    expect('bookTitle: \'\',').toMatch(/bookTitle:\s*''/)
  })
})
