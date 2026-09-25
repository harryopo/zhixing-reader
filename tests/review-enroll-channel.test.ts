import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import {
  booksDb,
  cardsDb,
  knowledgeCardsDb,
  getDatabase,
} from '../electron/database'

/**
 * 「加入 / 移出复习队列」这两条通道：注册**真实的** handler 再直接调，
 * 而不是只测 cardsDb —— 少注册一条、通道名打错一个字、kind 白名单漏防，
 * 数据库那侧照样全绿，界面上却是点了没反应。
 */

// books.ts 会连带加载 settings-service，它在模块期就绑定 userData：独占一个测试 profile
vi.hoisted(() => {
  process.env.ZHIXING_TEST_PROFILE = 'user-data-review-enroll'
})
const { registerBookHandlers } = await import('../electron/ipc/books')

type Handler = (...args: unknown[]) => unknown

function realHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerBookHandlers((channel, handler) => {
    handlers.set(channel, handler as Handler)
  })
  return handlers
}

function countOf(table: string, where: string, params: unknown[] = []): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params as never[])
  return rows.length > 0 ? Number(rows[0].values[0][0]) : -1
}

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '一本书' })
  knowledgeCardsDb.create({ id: 'k1', book_id: 'b1', type: 'concept', title: '概念一', content: '正文一' })
  knowledgeCardsDb.create({ id: 'k2', book_id: 'b1', type: 'quote', title: '概念二', content: '正文二' })
})

afterEach(() => {
  teardownTestDatabase()
})

describe('cards:enroll / cards:unenroll / cards:enrolledSources', () => {
  it('三条通道都注册在常量表说的那两个名字上', () => {
    const keys = [...realHandlers().keys()]
    expect(keys).toContain(IPC_CHANNELS.CARDS.ENROLL)
    expect(keys).toContain(IPC_CHANNELS.CARDS.UNENROLL)
    expect(keys).toContain(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)
  })

  it('批量入队一次请求搞定；重复入队不会建出第二张卡', () => {
    const handlers = realHandlers()
    const first = handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('knowledge_card', ['k1', 'k2']) as {
      created: number
      skipped: number
      actionable: number
    }
    expect(first.created).toBe(2)
    expect(first.skipped).toBe(0)
    expect(first.actionable).toBeGreaterThan(0)

    const again = handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('knowledge_card', ['k1']) as {
      created: number
      skipped: number
    }
    expect(again).toEqual({ created: 0, skipped: 1, actionable: expect.any(Number) })
    expect(countOf('cards', 'knowledge_card_id = ?', ['k1'])).toBe(1)
  })

  it('enrolledSources 回的就是队列里那些 id，移出后名单与卡片都少一个', () => {
    const handlers = realHandlers()
    handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('knowledge_card', ['k1', 'k2'])
    const listed = handlers.get(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)?.('knowledge_card') as {
      ids: string[]
    }
    expect(listed.ids.sort()).toEqual(['k1', 'k2'])

    handlers.get(IPC_CHANNELS.CARDS.UNENROLL)?.('knowledge_card', 'k1')
    const after = handlers.get(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)?.('knowledge_card') as {
      ids: string[]
    }
    expect(after.ids).toEqual(['k2'])
    // 移出队列只撤复习卡，卡片本身必须还在
    expect(countOf('knowledge_cards', "id = 'k1'")).toBe(1)
  })

  it('白名单以外的类型与不合法的 ids 都被拒，且没有写进任何东西', () => {
    const handlers = realHandlers()
    expect(() => handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('books', ['k1'])).toThrow(
      '不支持放进复习队列的来源类型',
    )
    expect(() => handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('knowledge_card', 'k1')).toThrow(
      '要加入复习队列的 id 不合法',
    )
    expect(() =>
      handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('knowledge_card', ['k1', '']),
    ).toThrow('要加入复习队列的 id 不合法')
    expect(cardsDb.count()).toBe(0)
    // 名单查询走宽容路径：不认识的类型回空表，不让设置页因为一个坏 kind 崩掉
    expect(handlers.get(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)?.('books')).toEqual({ ids: [] })
  })

  it('enroll 幂等这条也管着划线卡（历史上同一划线能被建出两张卡）', () => {
    const handlers = realHandlers()
    getDatabase().run(
      "INSERT INTO highlights (id, book_id, content) VALUES ('h1', 'b1', '一条划线')",
    )
    // 直接走数据层建划线卡（`cards:create` 那条通道已删 —— 渲染层零消费者，
    // 建卡的实际入口是 `card.enroll`，这里要验的正是两者的幂等一致性）
    cardsDb.create('h1')
    const again = handlers.get(IPC_CHANNELS.CARDS.ENROLL)?.('highlight', ['h1']) as {
      created: number
      skipped: number
    }
    expect(again).toEqual({ created: 0, skipped: 1, actionable: expect.any(Number) })
    expect(countOf('cards', 'highlight_id = ?', ['h1'])).toBe(1)
  })
})
