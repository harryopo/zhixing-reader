// @vitest-environment happy-dom
/**
 * 书架那一批「逐本取卡片」的读法。
 *
 * 立它的理由：原来这一路是 `Promise.all(ids.map(id => card.getByBook(id).catch(() => [])))` ——
 * 一本读失败就静默变成"这本书 0 张卡片"，而界面上那个 0 与真实的 0 长得一模一样，
 * 「待复习」筛选还会把这本悄悄排除掉。抽成一个函数只为了能把"哪几本没读到"交出去。
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readBookCards } from '../book-cards'

const getByBook = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { card: { getByBook } },
  })
  getByBook.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('全部读到时：卡片合在一起，没有一本记为没读到', async () => {
  getByBook
    .mockResolvedValueOnce([{ id: 'c1', book_id: 'b1' }, { id: 'c2', book_id: 'b1' }])
    .mockResolvedValueOnce([{ id: 'c3', book_id: 'b2' }])

  const result = await readBookCards(['b1', 'b2'])

  expect(result.cards.map((c) => (c as { id: string }).id)).toEqual(['c1', 'c2', 'c3'])
  expect(result.failedBookIds).toEqual([])
})

it('一本读失败：其余各本的卡片照样带回来（一层坏了不许把另一层带走）', async () => {
  getByBook
    .mockRejectedValueOnce(new Error('db down'))
    .mockResolvedValueOnce([{ id: 'c3', book_id: 'b2' }])

  const result = await readBookCards(['b1', 'b2'])

  expect(result.cards.map((c) => (c as { id: string }).id)).toEqual(['c3'])
})

it('失败的那一本要被点名交出去，不是静默少一本', async () => {
  getByBook
    .mockResolvedValueOnce([{ id: 'c1', book_id: 'b1' }])
    .mockRejectedValueOnce(new Error('db down'))

  const result = await readBookCards(['b1', 'b2'])

  expect(result.failedBookIds).toEqual(['b2'])
})

it('每本恰好问一次，不多问也不漏问', async () => {
  getByBook.mockResolvedValue([])

  await readBookCards(['b1', 'b2', 'b3'])

  expect(getByBook.mock.calls.map((call) => call[0])).toEqual(['b1', 'b2', 'b3'])
})

it('一本都没有时不去问任何一次', async () => {
  const result = await readBookCards([])

  expect(result).toEqual({ cards: [], failedBookIds: [] })
  expect(getByBook).not.toHaveBeenCalled()
})
