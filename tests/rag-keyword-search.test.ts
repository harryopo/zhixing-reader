// 知行读书 — 关键词检索（electron/services/rag-service.ts）
//
// ## 为什么单独测这个
// 用户的 AI 服务商（DeepSeek）**没有 /embeddings 接口**，所以语义检索在本机永远用不了，
// 关键词检索是**唯一的**书籍上下文来源。而它原来的切词是
// `query.split(/[\s,，。？?!！、]+/)` —— 中文句子没有空格，整句会变成一个"词"，
// 拿去 `includes` 几乎永远为 false。结果：**每次中文提问都检索到 0 条**，
// AI 带着零条书籍上下文回答，而日志里还写着"用了语义检索"。
//
// 这里守三件事：
//   1. 中文查询必须能命中中文划线（bigram 展开）
//   2. 英文查询行为不变
//   3. 不相干的查询不许硬凑结果

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { initRepositoryFactory, getRepositories } from '../electron/repositories'
import { getDatabase } from '../electron/database/connection'
import { expandQueryTerms, keywordSearch } from '../electron/services/rag-service'
import { booksDb, highlightsDb } from '../electron/database'

describe('expandQueryTerms — 中文查询切词', () => {
  it('中文整句按 2 字滑窗展开（这是修复的核心）', () => {
    const terms = expandQueryTerms('人际关系重要吗')
    expect(terms).toContain('人际')
    expect(terms).toContain('际关')
    expect(terms).toContain('关系')
    expect(terms).toContain('重要')
    // 关键：不能再把整句当成一个"词"
    expect(terms).not.toContain('人际关系重要吗')
  })

  it('中文短词保持原样（2 字以内不拆）', () => {
    expect(expandQueryTerms('习惯')).toEqual(['习惯'])
  })

  it('中英混排：英文按词、中文按 bigram', () => {
    const terms = expandQueryTerms('habit 习惯养成')
    expect(terms).toContain('habit')
    expect(terms).toContain('习惯')
    expect(terms).toContain('惯养')
    expect(terms).toContain('养成')
  })

  it('标点被切开，不产生空词', () => {
    const terms = expandQueryTerms('这本书讲了什么？作者是谁？')
    expect(terms.every((t) => t.length > 0)).toBe(true)
    expect(terms).toContain('作者')
  })

  it('空白查询返回空数组（调用方据此走"返回最近几条"的兜底）', () => {
    expect(expandQueryTerms('   ')).toEqual([])
    expect(expandQueryTerms('，。？')).toEqual([])
  })
})

describe('keywordSearch — 中文提问必须能命中自己的划线', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    initRepositoryFactory(getDatabase)
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    booksDb.create({ id: 'b2', title: '另一本书' } as never)
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系' } as never)
    highlightsDb.create({ id: 'h2', book_id: 'b1', content: '所谓自由就是被别人讨厌' } as never)
    highlightsDb.create({ id: 'h3', book_id: 'b2', content: '习惯的养成需要环境设计' } as never)
  })
  afterEach(() => teardownTestDatabase())

  it('**中文提问命中中文划线**（修复前这里返回 0 条）', () => {
    const results = keywordSearch('人际关系为什么会让人烦恼', 'b1', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].highlightId).toBe('h1')
    expect(results[0].content).toContain('人际关系')
  })

  it('只在本内检索，不串到别的书', () => {
    const results = keywordSearch('习惯养成', 'b1', 5)
    expect(results.every((r) => r.bookId === 'b1')).toBe(true)
  })

  it('英文查询照常工作', () => {
    highlightsDb.create({ id: 'h4', book_id: 'b1', content: 'Habits shape identity' } as never)
    const results = keywordSearch('habits identity', 'b1', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].highlightId).toBe('h4')
  })

  it('完全不相干的查询返回空，不硬凑', () => {
    expect(keywordSearch('量子纠缠的数学基础', 'b1', 5)).toEqual([])
  })

  it('返回结果按相关度降序，且条数不超过 limit', () => {
    const results = keywordSearch('人际关系 自由 讨厌', 'b1', 1)
    expect(results).toHaveLength(1)
    expect(results[0].highlightId).toBe('h1')
  })

  it('查询里只有标点时兜底返回前几条（relevanceScore 标成 0.1，不假装相关）', () => {
    const results = keywordSearch('？？？', 'b1', 2)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.relevanceScore === 0.1)).toBe(true)
  })

  it('给不存在的书检索返回空数组，不抛错', () => {
    expect(keywordSearch('人际关系', 'nope', 5)).toEqual([])
  })
})
