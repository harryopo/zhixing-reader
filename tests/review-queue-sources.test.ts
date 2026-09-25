import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import initSqlJs, { Database } from 'sql.js'
import {
  injectTestDatabase,
  resetTestDatabaseState,
  applySchemaAndMigrations,
  getDatabase,
  booksDb,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  cardsDb,
  reviewsDb,
} from '../electron/database'
import { Rating } from '../electron/fsrs-engine'

/**
 * 老库（cards 只认划线、highlight_id 还是 NOT NULL）怎么升到"三种来源"。
 *
 * 这条测试要钉住三件容易各自漂的事：
 *   1. 迁移**搬数据**而不是重建空表 —— 用户已有的复习进度（state/due/reps/lapses）
 *      不能因为升级被清零；
 *   2. 迁移**幂等** —— 每次启动都会跑一遍，跑第二遍不许报错也不许改数据；
 *   3. 新建库与迁移后的库**形状必须一致** —— 一处 CHECK、一处外键，
 *      漏了另一边就是"新库正常、老库能塞进坏数据"。
 */

/**
 * v1.3.4 之前线上 cards 的形状。
 * 逐字从当时提交的 schema.ts 里抄出来（不是凭记忆写），否则"旧库"这个前提就是假的：
 * 少一列、或 highlight_id 不是 NOT NULL，测的就不是真迁移。
 */
const LEGACY_CARDS_DDL = `
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    highlight_id TEXT NOT NULL,
    state INTEGER DEFAULT 0,
    step INTEGER DEFAULT 0,
    stability REAL DEFAULT 0,
    difficulty REAL DEFAULT 0,
    due TEXT NOT NULL,
    last_review TEXT,
    elapsed_days INTEGER DEFAULT 0,
    scheduled_days INTEGER DEFAULT 0,
    reps INTEGER DEFAULT 0,
    lapses INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE
  )
`

function countOf(table: string, where = '1=1', params: unknown[] = []): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params as never[])
  return rows.length > 0 ? Number(rows[0].values[0][0]) : -1
}

function columnNames(table: string): string[] {
  const rows = getDatabase().exec(`PRAGMA table_info(${table})`)
  if (rows.length === 0) return []
  const cols = rows[0].columns
  return rows[0].values.map((v) => String(v[cols.indexOf('name')]))
}

function scalar(sql: string): number {
  const rows = getDatabase().exec(sql)
  return rows.length ? Number(rows[0].values[0][0]) : -1
}

describe('cards 从单来源升到三来源', () => {
  let legacy: Database

  beforeEach(async () => {
    const SQL = await initSqlJs()
    legacy = new SQL.Database()
    injectTestDatabase(legacy)
    // 旧库：cards 已经存在且带着复习过的数据
    legacy.run(LEGACY_CARDS_DDL)
    legacy.run(
      `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, reps, lapses)
       VALUES ('c_old', 'h_old', 2, 3, 41.5, 6.2, '2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 7, 2)`,
    )
    applySchemaAndMigrations()
    // 旧库里的卡总有真划线可指：把那个父行补出来（旧库建表时外键默认是关的，
    // 所以"只有卡没有划线"这种形状在测试里能塞进去 —— 真库里不会这样）
    booksDb.create({ id: 'b_old', title: '旧书' })
    getDatabase().run(
      "INSERT INTO highlights (id, book_id, content) VALUES ('h_old', 'b_old', '旧库里的一条划线')",
    )
  })

  afterEach(() => {
    resetTestDatabaseState()
  })

  it('旧卡带着复习进度活过迁移（state / 稳定性 / 到期时间 / 次数一个没丢）', () => {
    const rows = getDatabase().exec("SELECT * FROM cards WHERE id = 'c_old'")
    expect(rows.length).toBe(1)
    const cols = rows[0].columns
    const row = Object.fromEntries(cols.map((c, i) => [c, rows[0].values[0][i]]))
    expect(row.state).toBe(2)
    expect(row.stability).toBe(41.5)
    expect(row.difficulty).toBe(6.2)
    expect(row.due).toBe('2026-10-01T00:00:00.000Z')
    expect(row.reps).toBe(7)
    expect(row.lapses).toBe(2)
    expect(row.highlight_id).toBe('h_old')
    expect(row.knowledge_card_id).toBeNull()
  })

  it('迁移是幂等的：再跑一次，行数与内容不变', () => {
    applySchemaAndMigrations()
    applySchemaAndMigrations()
    expect(countOf('cards', "id = 'c_old'")).toBe(1)
    expect(columnNames('cards')).toContain('methodology_id')
  })

  it('迁移完外键仍然是开的（重建期间要关，收尾必须开回来）', () => {
    expect(scalar('PRAGMA foreign_keys')).toBe(1)
  })

  it('迁移不靠"整表重建"顺手丢行：迁移前后各表行数一字不差', () => {
    booksDb.create({ id: 'b2', title: '第二本书' })
    highlightsDb.create({ id: 'h2', book_id: 'b2', content: '另一条划线', note: '' })
    cardsDb.create('h2')
    const snapshot = () => ({
      cards: scalar('SELECT COUNT(*) FROM cards'),
      highlights: scalar('SELECT COUNT(*) FROM highlights'),
      books: scalar('SELECT COUNT(*) FROM books'),
    })
    const before = snapshot()
    applySchemaAndMigrations()
    expect(snapshot()).toEqual(before)
    expect(before.cards).toBe(2)
  })

  it('旧外键还在干活：删划线带走它的卡', () => {
    booksDb.create({ id: 'b1', title: '一本书' })
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一条划线', note: '' })
    const card = cardsDb.create('h1')
    expect(countOf('cards', 'id = ?', [card.id])).toBe(1)
    highlightsDb.delete('h1')
    expect(countOf('cards', 'id = ?', [card.id])).toBe(0)
  })

  it('迁移后的库没有指向已删来源的卡，且比旧库多两个来源列与三条外键', () => {
    expect(scalar('SELECT COUNT(*) FROM cards WHERE highlight_id IS NULL')).toBe(0)
    // foreign_key_check 每行是一条违规，没有违规时它不返回结果集
    expect(getDatabase().exec('PRAGMA foreign_key_check(cards)')).toHaveLength(0)
    const columns = columnNames('cards')
    expect(columns).toEqual(
      expect.arrayContaining(['highlight_id', 'knowledge_card_id', 'methodology_id']),
    )
    // 旧形状只有 1 条外键（指向 highlights），重建后三种来源各一条
    expect(getDatabase().exec('PRAGMA foreign_key_list(cards)')[0].values).toHaveLength(3)
  })

  it('新建库与迁移后的库形状一致（列集合与外键条数都不许分叉）', async () => {
    const migratedColumns = [...columnNames('cards')].sort()
    const migratedFks = getDatabase().exec('PRAGMA foreign_key_list(cards)')[0].values.length

    const SQL = await initSqlJs()
    const fresh = new SQL.Database()
    injectTestDatabase(fresh)
    applySchemaAndMigrations()

    expect([...columnNames('cards')].sort()).toEqual(migratedColumns)
    expect(getDatabase().exec('PRAGMA foreign_key_list(cards)')[0].values.length).toBe(migratedFks)
  })
})

describe('三种来源的复习卡', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    injectTestDatabase(db)
    applySchemaAndMigrations()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' })
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '一切烦恼都来自人际关系', note: '第二夜开头' })
    knowledgeCardsDb.create({
      id: 'k1',
      book_id: 'b1',
      type: 'concept',
      title: '课题分离',
      content: '分清这是谁的课题，只管自己能决定的那部分',
      interpretation: '判断标准：结果最终由谁承担',
    })
    methodologiesDb.create({
      id: 'm1',
      book_id: 'b1',
      name: '深呼吸法',
      description: '紧张时先稳住身体',
      trigger_scenario: '上台前',
      steps: ['吸气 4 秒', '屏息 4 秒', '呼气 6 秒'],
    })
  })

  afterEach(() => {
    resetTestDatabaseState()
  })

  it('知识卡片与方法论能进队列，并且各自只有一张卡', () => {
    const first = cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
    const second = cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.card.id).toBe(first.card.id)
    expect(countOf('cards', 'knowledge_card_id = ?', ['k1'])).toBe(1)

    cardsDb.enroll({ kind: 'methodology', id: 'm1' })
    expect(countOf('cards', 'methodology_id = ?', ['m1'])).toBe(1)
  })

  it('一张卡只能有一个来源（三个来源都指 / 一个都不指都被 CHECK 拦下）', () => {
    expect(() =>
      getDatabase().run(
        "INSERT INTO cards (id, highlight_id, knowledge_card_id, due) VALUES ('bad', 'h1', 'k1', '2026-09-25T00:00:00.000Z')",
      ),
    ).toThrow()
    expect(() =>
      getDatabase().run(
        "INSERT INTO cards (id, due) VALUES ('bad2', '2026-09-25T00:00:00.000Z')",
      ),
    ).toThrow()
    expect(countOf('cards', "id IN ('bad', 'bad2')")).toBe(0)
  })

  it('给不存在的来源建卡会被外键挡掉', () => {
    expect(() => cardsDb.enroll({ kind: 'knowledge_card', id: 'nope' })).toThrow()
  })

  it('队列里三种卡各自问什么、答什么都对得上', () => {
    cardsDb.enroll({ kind: 'highlight', id: 'h1' })
    cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
    cardsDb.enroll({ kind: 'methodology', id: 'm1' })
    // 三张都是新卡，每日新卡上限默认 15，所以一次能全取到
    const queue = cardsDb.getDueCardsWithContent(100)
    const byKind = new Map(queue.map((c) => [c.sourceKind, c]))

    const highlight = byKind.get('highlight')
    expect(highlight?.front).toBe('一切烦恼都来自人际关系')
    expect(highlight?.label).toBe('划线')
    expect(highlight?.sourceLine).toBe('《被讨厌的勇气》')

    const concept = byKind.get('knowledge_card')
    expect(concept?.front).toBe('课题分离')
    expect(concept?.back).toBe('分清这是谁的课题，只管自己能决定的那部分')
    expect(concept?.detail).toBe('解读：判断标准：结果最终由谁承担')
    expect(concept?.label).toBe('知识卡片')

    const method = byKind.get('methodology')
    expect(method?.front).toBe('深呼吸法 · 什么时候用：上台前')
    expect(method?.back).toBe('1. 吸气 4 秒\n2. 屏息 4 秒\n3. 呼气 6 秒')
    expect(method?.detail).toBe('它是什么：紧张时先稳住身体')
    expect(method?.label).toBe('方法论')
  })

  it('步骤存成老样式（纯文本 / 坏 JSON）时原样给出，不静默丢内容', () => {
    methodologiesDb.create({ id: 'm2', book_id: 'b1', name: '老数据方法', steps: '先停一下，再呼吸' })
    cardsDb.enroll({ kind: 'methodology', id: 'm2' })
    const queue = cardsDb.getDueCardsWithContent(100)
    const method = queue.find((c) => c.sourceId === 'm2')
    expect(method?.back).toBe('先停一下，再呼吸')
  })

  it('知识卡片被删除时它的复习卡一起消失（外键级联，不留孤儿）', () => {
    const enrolled = cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
    reviewsDb.create(enrolled.card.id, Rating.Good)
    expect(countOf('reviews', 'card_id = ?', [enrolled.card.id])).toBe(1)

    knowledgeCardsDb.delete('k1')
    expect(countOf('cards', 'id = ?', [enrolled.card.id])).toBe(0)
    expect(countOf('reviews', 'card_id = ?', [enrolled.card.id])).toBe(0)
  })

  it('书籍详情的卡片数不再只数划线卡', () => {
    cardsDb.enroll({ kind: 'highlight', id: 'h1' })
    cardsDb.enroll({ kind: 'knowledge_card', id: 'k1' })
    cardsDb.enroll({ kind: 'methodology', id: 'm1' })
    expect(cardsDb.getByBookId('b1')).toHaveLength(3)
  })
})
