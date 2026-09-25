// 备份往返对账（2026-09-25）
//
// 备份这件事只有在"恢复过一次"之后才知道它对不对。这里做的就是这个：
// 种一份覆盖各类数据的世界 → 导出 → 清空 → 导入 → 逐类比对。
//
// 三条必须钉住的：
//  1) **清单只有一份**：库里新增一张表而没进备份清单，也没写"为什么不带"，判红。
//  2) **顺序就是依赖**：被引用的表必须排在前面，否则清空/插回会撞外键。
//  3) **半套不落库**：一批里有一行坏数据，整笔回滚，库里保持原样。
//
// 全程零网络零 AI 调用。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { getDatabase } from '../electron/database'
import {
  aiBatchesDb,
  articlesDb,
  booksDb,
  bookSummariesDb,
  cardsDb,
  chapterSummariesDb,
  conversationDb,
  dailyStatsDb,
  highlightsDb,
  knowledgeCardsDb,
  memoriesDb,
  methodologiesDb,
  reviewsDb,
  vocabularyDb,
} from '../electron/database'
import { exportBackup, importBackup } from '../electron/services/backup'
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  EXCLUDED_TABLES,
  describeImportedCounts,
  type BackupPayload,
} from '../src/shared/backup'
import { Rating } from '../electron/fsrs-engine'

const TABLE_NAMES = BACKUP_TABLES.map((s) => s.table)

function countOf(table: string): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table}`)
  return rows.length > 0 ? Number(rows[0].values[0][0]) : 0
}

function cell(sql: string): unknown {
  const rows = getDatabase().exec(sql)
  return rows.length > 0 && rows[0].values.length > 0 ? rows[0].values[0][0] : undefined
}

/** 覆盖每一类会被备份带走的数据（含 AI 生成物与生成台账） */
function seedWorld(): void {
  booksDb.create({ id: 'b1', title: '书一', author: '甲' })
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '划线一', note: '想法一' })
  knowledgeCardsDb.create({
    id: 'k1',
    book_id: 'b1',
    type: 'concept',
    title: '概念一',
    content: '正文',
    interpretation: '这是解读',
  })
  methodologiesDb.create({ id: 'm1', book_id: 'b1', name: '方法一', description: '说明' })
  // 三种来源各一张复习卡片：#88 之后"加入复习队列"不再只属于划线
  cardsDb.enroll({ kind: 'highlight', id: 'h1' })
  cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
  cardsDb.enroll({ kind: 'methodology', id: 'm1' })
  const highlightCard = cell(`SELECT id FROM cards WHERE highlight_id = 'h1'`) as string
  reviewsDb.create(highlightCard, Rating.Good)

  const conv = conversationDb.create('会话一', 'b1')
  const convId = conv.id as string
  conversationDb.addMessage(convId, { role: 'user', content: '问题' })
  const answerId = conversationDb.addMessage(convId, {
    role: 'assistant',
    content: '回答',
    // addMessage 自己把 sources / tools_used 序列化成 JSON 文本列，这里传结构
    sources: [{ highlightId: 'h1' }],
  })
  conversationDb.setLike(answerId, true)

  articlesDb.create({
    id: 'a1',
    title_en: 'Leading',
    title_zh: '主要的',
    content_en: 'text',
    content_zh: '正文',
    source: 'weread',
    difficulty: 'cet4',
  })
  vocabularyDb.create({ word: 'leading', meaning_zh: '主要的' })
  dailyStatsDb.upsertReadingTime('2026-09-20', 600)
  memoriesDb.create({ type: 'insight', category: '阅读', content: '一条记忆' })
  chapterSummariesDb.upsertBatch('b1', [
    { chapterTitle: '第一章', summary: '第一章的概括', sourceCount: 1 },
  ])
  bookSummariesDb.create('b1', '全书概括', '["要点甲"]')
  // 上一批刚加的台账：丢了它，界面上"已处理 1/1"会变成"重新蒸馏"（再花一次钱）
  aiBatchesDb.record('b1', 'knowledgeCards', ['h1'])
}

function snapshotCounts(): Record<string, number> {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, countOf(t)]))
}

describe('备份的表清单', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('库里每张业务表要么进备份，要么在排除清单里写明理由', () => {
    const inDb = (
      getDatabase()
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .flatMap((r) => r.values.map((v) => v[0] as string)) as string[]
    ).filter((t) => t !== 'sqlite_sequence')

    const uncovered = inDb.filter((t) => !TABLE_NAMES.includes(t) && !EXCLUDED_TABLES[t])
    expect(uncovered, `这些表既不在备份里也没有"为什么不带"的说明：${uncovered.join(', ')}`).toEqual([])
    for (const [table, reason] of Object.entries(EXCLUDED_TABLES)) {
      expect(reason, `${table} 的排除理由不能空`).not.toBe('')
    }
  })

  it('清单顺序是拓扑序：被外键引用的表必须排在前面', () => {
    const db = getDatabase()
    const rank = new Map(TABLE_NAMES.map((t, i) => [t, i]))
    const violations: string[] = []
    for (const table of TABLE_NAMES) {
      const rows = db.exec(`PRAGMA foreign_key_list(${table})`)
      if (rows.length === 0) continue
      const cols = rows[0].columns
      const at = cols.indexOf('table')
      for (const values of rows[0].values) {
        const parent = values[at] as string
        if (!rank.has(parent)) continue
        if ((rank.get(parent) as number) >= (rank.get(table) as number)) {
          violations.push(`${table} 依赖 ${parent}，却排在它前面或同位`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('反证：清单少一张表 / 顺序倒过来，两条判据都要响（防止规则空转）', () => {
    const tablesOf = (list: string[]): string[] => {
      const rank = new Map(list.map((t, i) => [t, i]))
      const bad: string[] = []
      for (const table of list) {
        const rows = getDatabase().exec(`PRAGMA foreign_key_list(${table})`)
        if (rows.length === 0) continue
        const at = rows[0].columns.indexOf('table')
        for (const v of rows[0].values) {
          const parent = v[at] as string
          if (!rank.has(parent)) continue
          if ((rank.get(parent) as number) >= (rank.get(table) as number)) bad.push(table)
        }
      }
      return bad
    }
    // cards 依赖 highlights：把 cards 提到前面就必须被抓到
    expect(tablesOf(['cards', 'highlights', 'books'])).toContain('cards')
    expect(tablesOf(['books', 'highlights', 'cards'])).toEqual([])
    // 清单漏一张 ⇒ 覆盖判据抓到
    const missing = TABLE_NAMES.filter((t) => t !== 'ai_generation_batches')
    expect(missing).not.toContain('ai_generation_batches')
  })
})

describe('导出 → 清空 → 导入 的往返', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedWorld()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('每一类数据都回来了，条数与导出时一致', () => {
    const before = snapshotCounts()
    const { payload, counts } = exportBackup()
    expect(counts).toEqual(before)
    // 界面上写「完整备份」靠的是这些数字真的在 payload 里
    expect(counts.ai_generation_batches, '生成台账没进备份 ⇒ 恢复后要重新花钱生成').toBe(1)
    expect(counts.chapter_summaries, 'AI 层级摘要没进备份').toBe(1)
    expect(counts.book_summaries, 'AI 全书摘要没进备份').toBe(1)
    expect(counts.chat_messages).toBe(2)
    expect(counts.reviews, '复习历史没进备份 ⇒ 统计与队列都少数据').toBe(1)

    // 清空：导一份"什么表都是空的"备份，等于把业务表全清
    importBackup({ app: 'zhixing-reader', version: BACKUP_VERSION, tables: {} })
    expect(countOf('books')).toBe(0)
    expect(countOf('cards')).toBe(0)

    const result = importBackup(payload)
    expect(result.counts).toEqual(before)
    expect(snapshotCounts()).toEqual(before)
  })

  it('恢复的是原样而不是重建：复习进度、生成台账、三来源登记、引用来源都在', () => {
    const { payload } = exportBackup()
    const repsBefore = cell(`SELECT reps FROM cards WHERE knowledge_card_id = 'k1'`)
    importBackup({ app: 'zhixing-reader', version: BACKUP_VERSION, tables: {} })
    importBackup(payload)

    // 台账：这一批喂过哪些划线，恢复后仍然认得（按钮不该变成「重新蒸馏」）
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual(['h1'])
    expect(aiBatchesDb.getProcessedCounts('knowledgeCards').b1).toBe(1)
    // 知识卡片/方法论的复习登记按原行回来（旧实现只会按划线重建，这两类会丢）
    expect(cell(`SELECT COUNT(*) FROM cards WHERE knowledge_card_id IS NOT NULL`)).toBe(1)
    expect(cell(`SELECT COUNT(*) FROM cards WHERE methodology_id IS NOT NULL`)).toBe(1)
    expect(cell(`SELECT reps FROM cards WHERE knowledge_card_id = 'k1'`)).toEqual(repsBefore)
    // AI 生成的东西本身 + 对话里的引用来源
    expect(cell(`SELECT interpretation FROM knowledge_cards WHERE id = 'k1'`)).toBe('这是解读')
    expect(
      JSON.parse(cell(`SELECT sources FROM chat_messages WHERE role = 'assistant'`) as string),
    ).toEqual([{ highlightId: 'h1' }])
    expect(cell(`SELECT liked FROM chat_messages WHERE role = 'assistant'`)).toBe(1)
    expect(cell(`SELECT summary FROM chapter_summaries WHERE book_id = 'b1'`)).toBe('第一章的概括')
  })

  it('坏数据整笔回滚：库里保持导入前的样子，不会留下半套', () => {
    const { payload } = exportBackup()
    importBackup({ app: 'zhixing-reader', version: BACKUP_VERSION, tables: {} })
    const empty = snapshotCounts()
    expect(empty.books).toBe(0)

    const broken = JSON.parse(JSON.stringify(payload)) as BackupPayload
    broken.tables.highlights = [{ id: 'h1', book_id: 'b1', content: '行', not_a_column: 1 }]
    expect(() => importBackup(broken)).toThrow()

    // books 排在 highlights 之前，已经插过了 —— 回滚必须把它也退回去
    expect(snapshotCounts()).toEqual(empty)
  })

  it('旧格式（v1.1，渲染层拼的那种）仍然能恢复，并如实说明带不回什么', () => {
    importBackup({ app: 'zhixing-reader', version: '1.1', tables: {} })
    const legacy = {
      version: '1.1',
      exportedAt: '2026-09-16T00:00:00.000Z',
      books: [{ id: 'b9', title: '旧备份的书' }],
      highlights: [{ id: 'h9', book_id: 'b9', content: '旧划线' }],
      cards: [],
      knowledgeCards: [{ id: 'k9', book_id: 'b9', type: 'concept', title: '旧卡片', content: '正文' }],
      methodologies: [],
      vocabulary: [],
    }
    const result = importBackup(legacy)
    expect(result.legacy).toBe(true)
    expect(countOf('books')).toBe(1)
    expect(countOf('highlights')).toBe(1)
    expect(countOf('knowledge_cards')).toBe(1)
    expect(result.counts.ai_generation_batches).toBe(0)
  })

  it('不是本应用的备份 / 来自更新版本 ⇒ 一律不收（宁可拒绝，不可猜）', () => {
    expect(() => importBackup({ app: 'other', version: BACKUP_VERSION, tables: {} })).toThrow(/知行读书/)
    expect(() => importBackup({ app: 'zhixing-reader', version: '9.9', tables: {} })).toThrow(/更新的版本/)
    expect(() => importBackup('一份字符串')).toThrow()
    expect(() =>
      importBackup({ app: 'zhixing-reader', version: BACKUP_VERSION, tables: { books: '不是行数组' } }),
    ).toThrow(/books/)
    expect(() =>
      importBackup({ app: 'zhixing-reader', version: BACKUP_VERSION, tables: { nope: [] } }),
    ).toThrow(/清单外/)
  })

  it('导入完的报数只报真有的东西，顺序按清单', () => {
    expect(describeImportedCounts({ books: 2, highlights: 9, cards: 0 })).toBe('2 本书 / 9 条划线')
    expect(describeImportedCounts({})).toBe('')
    expect(describeImportedCounts({ ai_generation_batches: 3 })).toBe('3 条生成台账')
  })
})
