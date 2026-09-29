// ipc/search 的 handler 行为测试（2026-09-29，销覆盖率 DEBT 一笔）
//
// `electron/ipc/search.ts` 实测 100 / 66.66 / 100 —— 少的那两条分支就是入参那一步：
// 原来写的是 `globalSearch(String(query ?? ''))`。渲染层只会发字符串，所以那两步
// 一直在"把别的东西硬掰成关键词"：`{}` 变成 `[object Object]`、`['拖延','自由']`
// 变成 `拖延,自由`（逗号在分词里不是分隔符，于是变成一个从没打过的词），
// 界面对它的回答是「库里没有找到相关内容」—— 关于用户数据的一句假话。
// 现在非字符串一律按"没有关键词"处理（空查询在 globalSearch 里直接短路，
// 所以不会退化成把全库倒出来）。
//
// 判据照旧：注册**真实的** registerSearchHandlers，数据库用真库（问"库里到底有没有
// 这一行"就只能拿真库跑），不 mock 任何一层。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { registerSearchHandlers } from '../electron/ipc/search'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import type { GlobalSearchResult } from '../src/shared/global-search'

type Handler = (...args: unknown[]) => unknown

const GLOBAL = IPC_CHANNELS.SEARCH.GLOBAL

/** 注册真实的 handler，把通道名到函数的映射抓下来 */
function register(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerSearchHandlers((channel, handler) => handlers.set(channel, handler))
  return handlers
}

function seedLibrary() {
  booksDb.create({ id: 'b1', title: '思考，快与慢' })
  highlightsDb.create({
    id: 'hl1',
    book_id: 'b1',
    chapter_title: '第五章',
    content: '注意力是有限的资源',
    note: '我在这条上拖延了很久',
  })
  // 标题里带数字的一张卡：用来证明"非字符串被硬掰成关键词"是真的会搜到东西的
  // （`String(42)` 与 `String([42])` 都是 '42'，都会命中它）
  knowledgeCardsDb.create({
    id: 'kc42',
    book_id: 'b1',
    type: 'quote',
    title: '第 42 条笔记',
    content: '编号 42 的引文',
  })
  knowledgeCardsDb.create({
    id: 'kc1',
    book_id: 'b1',
    type: 'concept',
    title: '拖延的结构性原因',
    content: '延迟折扣让短期奖励压倒长期目标',
  })
  methodologiesDb.create({
    id: 'm1',
    book_id: 'b1',
    name: '两分钟规则',
    description: '能把任务缩到两分钟就立刻做，用来对付拖延',
    steps: ['找出第一步', '把它压到两分钟内'],
  })
  articlesDb.create({
    id: 'a1',
    title_en: 'Why we procrastinate',
    title_zh: '我们为什么会拖延',
    content_en: 'Mood repair beats time management.',
    summary_zh: '情绪修复比时间管理更根本。',
    source: 'rss',
    category: 'learning',
    difficulty: 'cet4',
  })
  vocabularyDb.create({
    id: 'w1',
    word: 'procrastinate',
    phonetic: '/prəˈkræstɪneɪt/',
    part_of_speech: 'v.',
    meaning_zh: '拖延',
    example_en: 'I procrastinate when the task is vague.',
    example_zh: '任务模糊时我就会拖延。',
    source: 'article',
  })
}

describe('search:global 的注册形状', () => {
  let handlers: Map<string, Handler>

  beforeEach(() => {
    handlers = register()
  })

  it('只注册声明表里那一条通道（拼错常量时这里立刻红）', () => {
    expect([...handlers.keys()]).toEqual([GLOBAL])
  })

  it('注册这一步不碰库（库只在被调用那一刻才取）', () => {
    expect(handlers.get(GLOBAL)).toBeTypeOf('function')
  })
})

describe('search:global 走真库', () => {
  let run: (query: unknown) => GlobalSearchResult

  beforeEach(async () => {
    await setupTestDatabase()
    seedLibrary()
    const handlers = register()
    const handler = handlers.get(GLOBAL)
    if (!handler) throw new Error('search:global 没被注册')
    run = (query) => handler(query) as GlobalSearchResult
  })
  afterEach(() => teardownTestDatabase())

  it('一个关键词同时找遍五类（划线/卡片/方法论/文章/生词）', () => {
    const result = run('拖延')
    expect(result.groups.map((g) => g.kind).sort()).toEqual(
      ['article', 'card', 'highlight', 'methodology', 'word'].sort(),
    )
    // 划线那一类命中的是**想法里的**"拖延"，不是正文里的
    const highlight = result.groups.find((g) => g.kind === 'highlight')
    expect(highlight?.hits.map((h) => h.id)).toEqual(['hl1'])
  })

  it('报的数与给的行是同一批：total 是列出的条数，matchedTotal 不小于它', () => {
    const result = run('拖延')
    expect(result.total).toBe(result.groups.reduce((n, g) => n + g.hits.length, 0))
    expect(result.matchedTotal).toBeGreaterThanOrEqual(result.total)
  })

  it('多关键词是 AND：任一词在库里没有，那一类就不出现', () => {
    expect(run('拖延 库里没有这个词组').groups.find((g) => g.kind === 'highlight')).toBeUndefined()
    // 两个词都能在同一行里找到时才算命中（上一条不是空转）
    expect(
      run('拖延 资源').groups.find((g) => g.kind === 'highlight')?.hits.map((h) => h.id),
    ).toEqual(['hl1'])
  })

  it('每个命中都带回点得回去的链接（划线精确到那一条）', () => {
    const hit = run('拖延').groups.find((g) => g.kind === 'highlight')?.hits[0]
    expect(hit?.link).toContain(`highlight=${'hl1'}`)
    expect(hit?.link).toContain('b1')
  })

  it('空串与纯空白都不查库（不是把全库倒出来）', () => {
    const spy = vi.spyOn(getDatabase(), 'exec')
    expect(run('').groups).toEqual([])
    expect(run('   \n\t ').groups).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('正例：上面那条不是空转 —— 有词时确实去查了库', () => {
    const spy = vi.spyOn(getDatabase(), 'exec')
    expect(run('拖延').total).toBeGreaterThan(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('% 与下划线按字面匹配（没转义时 % 会命中所有行）', () => {
    expect(run('%').total).toBe(0)
    expect(run('_').total).toBe(0)
  })

  it('非字符串一律按"没有关键词"处理，不掰成一个用户没打过的词', () => {
    // 库里真有一条标题带 42 的卡片：`String(42)` 与 `String([42])` 都会变成 '42'
    // 而把它"搜到了" —— 那不是用户打的关键词，界面对它说"找到了"同样是假话。
    expect(run(42).total).toBe(0)
    expect(run(['42']).total).toBe(0)
    expect(run({ query: '42' }).total).toBe(0)
    expect(run(null).total).toBe(0)
    expect(run(undefined).total).toBe(0)
    // 反证：同一个词作为字符串发来，那条卡片真的会被搜出来
    expect(run('42').groups.flatMap((g) => g.hits.map((h) => h.id))).toContain('kc42')
  })

  it('读库炸了要抛出去，不在这里演成"没有结果"', () => {
    const spy = vi.spyOn(getDatabase(), 'exec').mockImplementation(() => {
      throw new Error('库读不动')
    })
    expect(() => run('拖延')).toThrow('库读不动')
    spy.mockRestore()
  })

  it('结果里不摆没命中的那一类（filter 生效，五类齐摆会让界面以为都搜过了）', () => {
    const result = run('注意力')
    expect(result.groups.map((g) => g.kind)).toEqual(['highlight'])
  })
})
