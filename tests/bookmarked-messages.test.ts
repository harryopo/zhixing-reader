import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { conversationDb, getDatabase } from '../electron/database'
import type { BookmarkedMessageRow } from '../src/shared/types'

/**
 * 跨会话「收藏」列表的取数（conversationsDb.getBookmarked）。
 *
 * 收藏这个动作本身早就存在（chat_messages.bookmarked），缺的是出口：
 * 出口要能说出"这条出自哪次对话"，并且会话删掉后不能留孤儿。
 */

function seedMessage(
  conversationId: string,
  id: string,
  content: string,
  createdAt: string,
  bookmarked: boolean,
): void {
  getDatabase().run(
    `INSERT INTO chat_messages (id, conversation_id, role, content, bookmarked, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?)`,
    [id, conversationId, content, bookmarked ? 1 : 0, createdAt],
  )
}

describe('收藏列表取数', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('只给收藏过的那几条，并带上所属会话的标题', () => {
    const a = conversationDb.create('关于被讨厌的勇气')
    const b = conversationDb.create('费曼教学：输入框')
    const aId = a.id as string
    const bId = b.id as string

    seedMessage(aId, 'm1', '第一条回答', '2026-09-20 10:00:00', true)
    seedMessage(aId, 'm2', '没收藏的回答', '2026-09-21 10:00:00', false)
    seedMessage(bId, 'm3', '另一个会话里收藏的', '2026-09-22 10:00:00', true)

    const rows = conversationDb.getBookmarked() as unknown as BookmarkedMessageRow[]
    expect(rows.map((r) => r.id).sort()).toEqual(['m1', 'm3'])
    const m3 = rows.find((r) => r.id === 'm3')
    expect(m3?.conversation_title).toBe('费曼教学：输入框')
    expect(m3?.conversation_id).toBe(bId)
  })

  it('最新收藏排在前面（列表按时间倒序读）', () => {
    const c = conversationDb.create('会话')
    const cid = c.id as string
    seedMessage(cid, 'old', '早上的', '2026-09-01 08:00:00', true)
    seedMessage(cid, 'new', '晚上的', '2026-09-23 21:00:00', true)

    const rows = conversationDb.getBookmarked() as unknown as BookmarkedMessageRow[]
    expect(rows.map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('取消收藏后立刻从列表消失（同一列，两个方向都得对）', () => {
    const c = conversationDb.create('会话')
    const cid = c.id as string
    seedMessage(cid, 'm1', '先收藏', '2026-09-20 10:00:00', true)
    expect(conversationDb.getBookmarked()).toHaveLength(1)

    conversationDb.setBookmark('m1', false)
    expect(conversationDb.getBookmarked()).toHaveLength(0)
  })

  it('limit 生效（收藏多了不许一次性灌进抽屉）', () => {
    const c = conversationDb.create('会话')
    const cid = c.id as string
    for (let i = 0; i < 5; i++) {
      seedMessage(cid, `m${i}`, `第 ${i} 条`, `2026-09-${10 + i} 10:00:00`, true)
    }
    expect(conversationDb.getBookmarked(2)).toHaveLength(2)
  })

  it('会话删掉后它的收藏跟着消失，列表里不留点不开的孤儿', () => {
    const c = conversationDb.create('要删掉的会话')
    const cid = c.id as string
    seedMessage(cid, 'm1', '收藏过', '2026-09-20 10:00:00', true)
    expect(conversationDb.getBookmarked()).toHaveLength(1)

    conversationDb.delete(cid)
    expect(conversationDb.getBookmarked()).toHaveLength(0)
  })

  it('反证：界面读一个 SELECT 里没有的键，确实拿不到值（说明形状对账不是空转）', () => {
    const c = conversationDb.create('会话')
    seedMessage(c.id as string, 'm1', '收藏', '2026-09-20 10:00:00', true)
    const [row] = conversationDb.getBookmarked() as unknown as Record<string, unknown>[]
    // 真实列叫 conversation_title；写成 session_title 就会静默拿到 undefined
    expect(row.session_title).toBeUndefined()
    expect(typeof row.conversation_title).toBe('string')
  })
})
