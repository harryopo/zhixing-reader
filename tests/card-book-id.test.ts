// 知行读书 — 卡片必须知道自己是哪本书的
//
// cards 表没有 book_id 这一列，只能经 cards.highlight_id → highlights.book_id 反查。
// 以前读卡片的 SQL 没做这个 JOIN，于是：
//   - 首页复习队列每条书名恒为「未关联书籍」
//   - 书架每本书的「N 张卡片」恒为 0、「待复习」筛选恒为空
// 管理后台更狠：knowledge_cards 的查询 JOIN 了不存在的 kc.highlight_id 列，
// SQL 直接抛错被 catch，整个「知识卡片」区连标题都不出现。
//
// 这三条都是"界面有、数据没通"，单测能在不打开界面的情况下抓出来，所以钉在这里。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, highlightsDb, cardsDb } from '../electron/database'
import { getDatabase } from '../electron/database/connection'
import { getCardsByBook } from '../electron/admin'

function seedBook(bookId: string, highlightCount: number) {
  booksDb.create({ id: bookId, title: `书 ${bookId}` } as never)
  for (let i = 0; i < highlightCount; i++) {
    const id = `${bookId}_hl_${i}`
    highlightsDb.create({ id, book_id: bookId, content: `${bookId} 的划线 ${i}` } as never)
    cardsDb.create(id)
  }
}

function seedKnowledgeCard(id: string, bookId: string) {
  getDatabase().run(
    'INSERT INTO knowledge_cards (id, book_id, type, title, content) VALUES (?, ?, ?, ?, ?)',
    [id, bookId, 'concept', `卡 ${id}`, `正文 ${id}`]
  )
}

describe('卡片读取路径必须带出 bookId', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedBook('b1', 2)
    seedBook('b2', 3)
  })

  afterEach(async () => {
    await teardownTestDatabase()
  })

  it('getByBookId 返回的每张卡都写着它属于哪本书', () => {
    const cards = cardsDb.getByBookId('b2')
    expect(cards).toHaveLength(3)
    expect(new Set(cards.map((c) => c.bookId))).toEqual(new Set(['b2']))
  })

  it('getDueCards 每张卡都带 bookId（新卡也一样，不是只有复习卡）', () => {
    const cards = cardsDb.getDueCards(100)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((c) => !!c.bookId)).toBe(true)
    expect(new Set(cards.map((c) => c.bookId))).toEqual(new Set(['b1', 'b2']))
  })

  it('不同书的卡片不会串到一本书的清单里', () => {
    const ids1 = cardsDb.getByBookId('b1').map((c) => c.id)
    const ids2 = cardsDb.getByBookId('b2').map((c) => c.id)
    expect(ids1.some((id) => ids2.includes(id))).toBe(false)
  })
})

describe('admin.getCardsByBook —— 按 knowledge_cards 的真实列查', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedBook('b1', 1)
    seedBook('b2', 1)
    seedKnowledgeCard('kc1', 'b1')
  })

  afterEach(async () => {
    await teardownTestDatabase()
  })

  it('不抛错（旧写法 JOIN 了不存在的列，整块卡片区因此永远不显示）', () => {
    expect(() => getCardsByBook('b1')).not.toThrow()
  })

  it('返回 title / content / type —— 界面显示的就是这三个，不是 question / answer', () => {
    const rows = getCardsByBook('b1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: '卡 kc1', content: '正文 kc1', type: 'concept' })
    expect(rows[0].question).toBeUndefined()
  })

  it('别的书的卡片不会混进来', () => {
    expect(getCardsByBook('b2')).toHaveLength(0)
  })
})
