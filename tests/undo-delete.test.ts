import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

// settings-service 在模块加载期就绑定 app.getPath('userData')，所以 profile 目录要早于
// 它的 import 定下来：独占一个，既不碰开发版目录，也不和 secret-* 那两个文件共用现场
// （vitest 按文件并行，共用会互删对方的 settings.json / secure/）。
vi.hoisted(() => {
  process.env.ZHIXING_TEST_PROFILE = 'user-data-undo-delete'
})
const { registerSettingsHandlers } = await import('../electron/ipc/settings')
import {
  booksDb,
  highlightsDb,
  cardsDb,
  knowledgeCardsDb,
  methodologiesDb,
  vocabularyDb,
  reviewsDb,
  getDatabase,
} from '../electron/database'
import {
  archiveAndDelete,
  restoreDeleted,
  clearArchives,
  SUPPORTED_DELETE_KINDS,
} from '../electron/services/deleted-archive'
import { Rating } from '../electron/fsrs-engine'
import type { UndoableDeleteKind } from '../src/shared/types'

/**
 * 删除可撤销：界面点「删除」下去的是物理 DELETE，撤销靠的是删之前留在内存里的那份现场。
 *
 * 这里量的是两件容易各自漂移的事：
 *   1. 现场收没收全 —— 删一条划线在 schema 里真的级联带走 cards 与 reviews，
 *      撤销若只插回划线，用户看到的是一张从零开始的空卡（FSRS 状态没了）；
 *   2. 白名单与类型对账 —— 联合类型里多一个 kind、白名单里少一个，界面上就会出现
 *      一个「删了但没留现场」的类型，而它永远不会报错，只是撤销点了没反应。
 */

function countOf(table: string, where = '1=1', params: unknown[] = []): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params as never[])
  return rows.length > 0 ? Number(rows[0].values[0][0]) : 0
}

function rowOf(table: string, id: string): Record<string, unknown> | undefined {
  const result = getDatabase().exec(`SELECT * FROM ${table} WHERE id = ?`, [id] as never[])
  if (result.length === 0 || result[0].values.length === 0) return undefined
  const cols = result[0].columns
  return Object.fromEntries(cols.map((c, i) => [c, result[0].values[0][i] as unknown]))
}

let cardId = ''
let reviewId = ''

/** 一条读过、复习过一次（所以有 FSRS 状态和复习记录）的划线 */
function seedReviewedHighlight(): void {
  booksDb.create({ id: 'b1', title: '第一本书' })
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '第一条划线', note: '' })
  highlightsDb.create({ id: 'h2', book_id: 'b1', content: '第二条划线', note: '' })
  cardId = cardsDb.create('h1').id
  reviewId = reviewsDb.create(cardId, Rating.Good).reviewId
  // 另一条划线也有卡片与记录：撤销不许把它们一起拽回来
  cardsDb.create('h2')
}

describe('删除的现场与撤销', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    clearArchives()
    seedReviewedHighlight()
  })

  afterEach(() => {
    clearArchives()
    teardownTestDatabase()
  })

  it('反证：动手之前划线、复习卡片、复习记录三张表确实都有行', () => {
    expect(countOf('highlights', "id = 'h1'")).toBe(1)
    expect(countOf('cards', 'id = ?', [cardId])).toBe(1)
    expect(countOf('reviews', 'id = ?', [reviewId])).toBe(1)
  })

  it('删一条划线：现场收全三张表（rowCount 含卡片与复习记录）', () => {
    const archived = archiveAndDelete('highlight', 'h1')
    expect(archived?.rowCount).toBe(3)
    expect(countOf('highlights', "id = 'h1'")).toBe(0)
    expect(countOf('cards', 'id = ?', [cardId])).toBe(0)
    expect(countOf('reviews', 'id = ?', [reviewId])).toBe(0)
  })

  it('撤销删掉的划线：卡片带着 FSRS 状态回来，不是从零开始的新卡', () => {
    const before = { card: rowOf('cards', cardId), review: rowOf('reviews', reviewId) }
    expect(before.card?.reps).toBe(1)
    const archived = archiveAndDelete('highlight', 'h1')
    expect(archiveAndDelete('highlight', 'h1')).toBeNull()

    const restored = restoreDeleted(archived?.token ?? '')
    expect(restored).toEqual({ ok: true, kind: 'highlight', rowCount: 3 })
    expect(rowOf('highlights', 'h1')?.content).toBe('第一条划线')
    expect(rowOf('cards', cardId)).toEqual(before.card)
    expect(rowOf('reviews', reviewId)).toEqual(before.review)
  })

  it('撤销只带回这一条划线的行，别条的不动', () => {
    const archived = archiveAndDelete('highlight', 'h1')
    restoreDeleted(archived?.token ?? '')
    expect(countOf('highlights', "book_id = 'b1'")).toBe(2)
    expect(countOf('cards', '1=1')).toBe(2)
  })

  it('同一个 token 只用一次：第二次撤销拿不到现场，也不会插出重复行', () => {
    const archived = archiveAndDelete('knowledge_card', seedKnowledgeCard())
    expect(restoreDeleted(archived?.token ?? '').ok).toBe(true)
    expect(restoreDeleted(archived?.token ?? '')).toEqual({
      ok: false,
      kind: null,
      rowCount: 0,
    })
    expect(countOf('knowledge_cards', '1=1')).toBe(1)
  })

  it('四种类型都能留现场并原样撤销', () => {
    const ids: Record<UndoableDeleteKind, string> = {
      highlight: 'h2',
      knowledge_card: seedKnowledgeCard(),
      methodology: seedMethodology(),
      vocabulary: seedWord(),
    }
    for (const kind of SUPPORTED_DELETE_KINDS) {
      const table = TABLE_OF_KIND[kind]
      const archived = archiveAndDelete(kind, ids[kind])
      expect(archived, kind).not.toBeNull()
      expect(countOf(table, 'id = ?', [ids[kind]]), kind).toBe(0)
      expect(restoreDeleted(archived?.token ?? '').ok, kind).toBe(true)
      expect(countOf(table, 'id = ?', [ids[kind]]), kind).toBe(1)
    }
  })

  it('行本来就不在：返回 null、什么都不删（不能假装删掉了再给一个没用的撤销）', () => {
    expect(archiveAndDelete('highlight', 'ghost')).toBeNull()
    expect(countOf('highlights', '1=1')).toBe(2)
    expect(countOf('cards', '1=1')).toBe(2)
  })

  it('删掉已入队的知识卡片：现场含它的复习卡与复习记录，撤销后三者一起回来', () => {
    const id = seedKnowledgeCard()
    const enrolled = cardsDb.enroll({ kind: 'knowledge_card', id })
    const reviewId = reviewsDb.create(enrolled.card.id, Rating.Good).reviewId

    const archived = archiveAndDelete('knowledge_card', id)
    expect(archived?.rowCount).toBe(3)
    expect(countOf('knowledge_cards', 'id = ?', [id])).toBe(0)
    expect(countOf('cards', 'id = ?', [enrolled.card.id])).toBe(0)
    expect(countOf('reviews', 'id = ?', [reviewId])).toBe(0)

    const restored = restoreDeleted(archived?.token ?? '')
    expect(restored).toEqual({ ok: true, kind: 'knowledge_card', rowCount: 3 })
    expect(countOf('knowledge_cards', 'id = ?', [id])).toBe(1)
    expect(countOf('cards', 'id = ?', [enrolled.card.id])).toBe(1)
    expect(countOf('reviews', 'id = ?', [reviewId])).toBe(1)
    // 复习进度没被清零：撤销回来的还是原来那张卡的状态
    expect(rowOf('cards', enrolled.card.id)?.reps).toBe(1)
  })

  it('白名单以外的类型直接抛错，且那一行还在', () => {
    expect(() => archiveAndDelete('book' as UndoableDeleteKind, 'b1')).toThrow(
      '不支持撤销的删除类型',
    )
    expect(countOf('books', "id = 'b1'")).toBe(1)
  })

  it('现场只留 20 份：最早那次删除撤销不了', () => {
    const tokens: string[] = []
    for (let i = 0; i < 21; i += 1) {
      const id = `word_overflow_${String(i)}`
      vocabularyDb.create({ id, word: `word${String(i)}`, meaning_zh: '意思' })
      const archived = archiveAndDelete('vocabulary', id)
      expect(archived, `第 ${String(i)} 次删除没留现场`).not.toBeNull()
      tokens.push(archived?.token ?? '')
    }
    expect(restoreDeleted(tokens[0]).ok).toBe(false)
    expect(restoreDeleted(tokens[20]).ok).toBe(true)
    // 最早那条被挤出现场，所以它确实还是删掉的样子
    expect(countOf('vocabulary', "id = 'word_overflow_0'")).toBe(0)
  })

  it('对账：shared 的 UndoableDeleteKind 联合类型与主进程白名单一套口径', () => {
    const source = readFileSync('src/shared/types.ts', 'utf8')
    const declared = source.match(/export type UndoableDeleteKind =([^\n]+)/)
    if (!declared) throw new Error('src/shared/types.ts 里找不到 UndoableDeleteKind 的声明')
    const members = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(new Set(members)).toEqual(new Set(SUPPORTED_DELETE_KINDS))
  })

  it('对账：白名单里每种类型指向的表都真实存在', () => {
    for (const kind of SUPPORTED_DELETE_KINDS) {
      const table = TABLE_OF_KIND[kind]
      expect(() => getDatabase().exec(`SELECT id FROM ${table} LIMIT 1`), table).not.toThrow()
    }
  })
})

const TABLE_OF_KIND: Record<UndoableDeleteKind, string> = {
  highlight: 'highlights',
  knowledge_card: 'knowledge_cards',
  methodology: 'methodologies',
  vocabulary: 'vocabulary',
}

function seedKnowledgeCard(): string {
  knowledgeCardsDb.create({
    id: 'k1',
    book_id: 'b1',
    type: 'concept',
    title: '一个概念',
    content: '正文',
  })
  return 'k1'
}

function seedMethodology(): string {
  methodologiesDb.create({ id: 'm1', book_id: 'b1', name: '一个方法' })
  return 'm1'
}

function seedWord(): string {
  vocabularyDb.create({ id: 'v1', word: 'serendipity', meaning_zh: '意外发现的美好' })
  return 'v1'
}

/**
 * 通道这一层单独量：上面那些用例直接调的是服务函数，绕过了 IPC。
 * 少注册一条 handler、通道名打错一个字，服务和数据库这侧照样全绿，
 * 而界面上是「点了删除没反应」—— 所以拿真实的 registerSettingsHandlers 再走一遍。
 */
type Handler = (...args: unknown[]) => unknown

function realHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerSettingsHandlers((channel, handler) => {
    handlers.set(channel, handler as Handler)
  })
  return handlers
}

describe('两条通道真的接上了', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    clearArchives()
    seedReviewedHighlight()
  })

  afterEach(() => {
    clearArchives()
    teardownTestDatabase()
  })

  it('ARCHIVE_DELETE 回 token、行确实没了；RESTORE_DELETE 按 token 把它带回来', () => {
    const handlers = realHandlers()
    const archived = handlers.get(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE)?.('highlight', 'h1') as
      | { token: string; rowCount: number }
      | null
    expect(archived?.rowCount).toBe(3)
    expect(countOf('highlights', "id = 'h1'")).toBe(0)

    const restored = handlers.get(IPC_CHANNELS.SYSTEM.RESTORE_DELETE)?.(archived?.token) as {
      ok: boolean
      kind: string | null
      rowCount: number
    }
    expect(restored).toEqual({ ok: true, kind: 'highlight', rowCount: 3 })
    expect(countOf('highlights', "id = 'h1'")).toBe(1)
    expect(countOf('cards', 'id = ?', [cardId])).toBe(1)
    expect(countOf('reviews', 'id = ?', [reviewId])).toBe(1)
  })

  it('通道名在两侧同源：常量表里的这两条就是注册用的那两条', () => {
    const handlers = realHandlers()
    expect([...handlers.keys()]).toContain(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE)
    expect([...handlers.keys()]).toContain(IPC_CHANNELS.SYSTEM.RESTORE_DELETE)
    // 反证：白名单之外的类型从通道进来也要抛错，而不是悄悄删掉
    expect(() => handlers.get(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE)?.('books', 'b1')).toThrow()
    expect(countOf('books', "id = 'b1'")).toBe(1)
  })
})
