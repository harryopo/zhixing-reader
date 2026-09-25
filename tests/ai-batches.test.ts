// AI 生成批次台账（ai_generation_batches）——「这本书还剩多少条没生成过」的真值来源
//
// 为什么要有这张表：知识卡片与方法论一次只能喂有限条划线，要分批续跑就必须知道
// 哪些划线**已经喂过**。卡片每张最多标 1 条来源、方法论最多标 3 条，拿它们当进度
// 会把已处理的算成没处理 —— 下一批再花钱喂一遍。台账记的是整批的 id 集合。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { aiBatchesDb, booksDb, getDatabase, resetDatabase } from '../electron/database'

function insertRawBatch(id: string, bookId: string, feature: string, highlightIds: string): void {
  getDatabase().run(
    'INSERT INTO ai_generation_batches (id, book_id, feature, highlight_ids) VALUES (?, ?, ?, ?)',
    [id, bookId, feature, highlightIds],
  )
}

function countRows(where = '1=1'): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ai_generation_batches WHERE ${where}`)
  return rows.length > 0 ? Number(rows[0].values[0][0]) : 0
}

describe('aiBatchesDb', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    booksDb.create({ id: 'b1', title: '第一本书' })
    booksDb.create({ id: 'b2', title: '第二本书' })
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('反证：没记过台账时，已处理数是 0（后面那些绿灯不是测试自己造的）', () => {
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual([])
    expect(aiBatchesDb.getProcessedCounts('knowledgeCards')).toEqual({})
  })

  it('记一批就能读回整批 id（跨批次取并集）', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1', 'h2', 'h3'])
    aiBatchesDb.record('b1', 'knowledgeCards', ['h3', 'h4'])

    expect(new Set(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards'))).toEqual(
      new Set(['h1', 'h2', 'h3', 'h4']),
    )
    // 并集去重：h3 在两个批次里各出现一次，只能算一条
    expect(aiBatchesDb.getProcessedCounts('knowledgeCards')).toEqual({ b1: 4 })
  })

  it('空批不记 —— 没有东西被处理过，不该在进度里占一格', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', [])
    expect(countRows()).toBe(0)
  })

  it('按书与按功能分开：b2 读不到 b1 的，方法论读不到知识卡片的', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1'])
    aiBatchesDb.record('b2', 'methodologies', ['h7', 'h8'])

    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies')).toEqual([])
    expect(aiBatchesDb.getProcessedIds('b2', 'knowledgeCards')).toEqual([])
    expect(aiBatchesDb.getProcessedCounts('methodologies')).toEqual({ b2: 2 })
  })

  it('clear 只归零这一本书这一个功能，别的不动', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1'])
    aiBatchesDb.record('b1', 'methodologies', ['h1'])
    aiBatchesDb.record('b2', 'knowledgeCards', ['h9'])

    expect(aiBatchesDb.clear('b1', 'knowledgeCards')).toBe(1)
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual([])
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies')).toEqual(['h1'])
    expect(aiBatchesDb.getProcessedIds('b2', 'knowledgeCards')).toEqual(['h9'])
  })

  it('clear 空台账返回 0，不开事务', () => {
    expect(aiBatchesDb.clear('b1', 'knowledgeCards')).toBe(0)
  })

  it('删掉一本书，它的台账一起被带走（外键级联）', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1'])
    booksDb.delete('b1')
    expect(countRows()).toBe(0)
  })

  it('highlight_ids 坏了的旧行按空批处理，不把整页拖崩', () => {
    insertRawBatch('aib_bad', 'b1', 'knowledgeCards', '{不是 JSON')
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual([])
    expect(aiBatchesDb.getProcessedCounts('knowledgeCards')).toEqual({})
  })

  it('存的是数组以外的 JSON（例如对象）也按空批处理', () => {
    insertRawBatch('aib_obj', 'b1', 'knowledgeCards', '{"0":"h1"}')
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual([])
  })

  it('重置数据库连台账一起清（否则重置后"还剩多少条"是错的）', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1', 'h2'])
    resetDatabase()
    expect(countRows()).toBe(0)
    expect(aiBatchesDb.getProcessedCounts('knowledgeCards')).toEqual({})
  })
})
