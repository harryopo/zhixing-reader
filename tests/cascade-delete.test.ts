import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  booksDb,
  highlightsDb,
  cardsDb,
  knowledgeCardsDb,
  methodologiesDb,
  getDatabase,
} from '../electron/database'

/**
 * 界面上的删除确认文案承诺"这本书的 N 条划线、M 张复习卡片，以及知识卡片与方法论
 * 会一起删掉"。这句话成立与否取决于 schema 的级联，不取决于文案 —— 所以拿真库验一遍。
 */

function countOf(table: string, where: string, params: unknown[] = []): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params as never[])
  return rows.length > 0 ? Number(rows[0].values[0][0]) : 0
}

/** 卡片 id 由 FSRS 侧生成，测试里记下来用于"哪张被带走"的断言 */
const cardIds: { h1: string; h2: string } = { h1: '', h2: '' }

function seedWorld(): void {
  booksDb.create({ id: 'b1', title: '第一本书' })
  booksDb.create({ id: 'b2', title: '第二本书' })
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '第一条划线', note: '' })
  highlightsDb.create({ id: 'h2', book_id: 'b1', content: '第二条划线', note: '带笔记' })
  highlightsDb.create({ id: 'h9', book_id: 'b2', content: '别的书的划线' })
  cardIds.h1 = cardsDb.create('h1').id
  cardIds.h2 = cardsDb.create('h2').id
  knowledgeCardsDb.create({ id: 'k1', book_id: 'b1', type: 'concept', title: '一个概念', content: '正文' })
  methodologiesDb.create({ id: 'm1', book_id: 'b1', name: '一个方法' })
}

describe('删除的级联', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedWorld()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('反证：动手之前这些行确实都在', () => {
    expect(countOf('highlights', "book_id = 'b1'")).toBe(2)
    expect(countOf('cards', '1=1')).toBe(2)
    expect(countOf('knowledge_cards', "book_id = 'b1'")).toBe(1)
    expect(countOf('methodologies', "book_id = 'b1'")).toBe(1)
  })

  it('删一条划线：只带走它自己的复习卡片，别条的不动', () => {
    highlightsDb.delete('h1')
    expect(countOf('highlights', "id = 'h1'")).toBe(0)
    expect(countOf('cards', 'id = ?', [cardIds.h1])).toBe(0)
    expect(countOf('cards', 'id = ?', [cardIds.h2])).toBe(1)
  })

  it('删一本书：它的划线、复习卡片、知识卡片、方法论一起消失', () => {
    booksDb.delete('b1')
    expect(countOf('highlights', "book_id = 'b1'")).toBe(0)
    expect(countOf('cards', '1=1')).toBe(0)
    expect(countOf('knowledge_cards', "book_id = 'b1'")).toBe(0)
    expect(countOf('methodologies', "book_id = 'b1'")).toBe(0)
  })

  it('删一本书不碰别的书（确认文案里的范围就是这一本）', () => {
    booksDb.delete('b1')
    expect(countOf('highlights', "book_id = 'b2'")).toBe(1)
  })

  it('外键是真的开着：卡片必须挂在存在的划线上（否则级联无从谈起）', () => {
    expect(() => cardsDb.create('does-not-exist')).toThrow()
    expect(highlightsDb.getById('h9')?.book_id).toBe('b2')
  })
})
