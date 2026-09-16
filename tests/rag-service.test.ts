// tests/rag-service.test.ts
//
// 检索适配层（electron/services/rag-service.ts）的集成测试。
//
// 这个文件守两件事：
//   1. 从真实数据库读出来的划线能被中文问题检索到（含书名）
//   2. 索引会随数据变化自动失效重建（签名机制）—— 否则用户新导入的划线永远搜不到

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { initRepositoryFactory } from '../electron/repositories'
import { getDatabase } from '../electron/database/connection'
import { booksDb, highlightsDb } from '../electron/database'
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
    initRepositoryFactory(getDatabase)
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
