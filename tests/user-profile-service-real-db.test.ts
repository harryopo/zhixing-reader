// 用户画像服务 × 真实数据库（2026-09-26）
//
// 立这条的起因：这一层原来通过 `electron/repositories/` 读数据，那套数据访问层整层撤掉之后，
// 六处读法直接换到 `electron/database/`。既有的 `tests/user-profile-service.test.ts` 把
// `electron/database` 整个 mock 掉了 —— mock 只能证明"服务按 mock 的返回值算数"，
// 证不了"真实那一行读出来就是这个形状"。这里用真库（sql.js 内存库 + 生产 schema）逐类对账。
//
// 特别注意 `analyzeLearningStyle()` / `analyzeConversationPatterns()` 各自包着 try/catch 兜底：
// 读口断掉时它会安静返回一套默认值，所以每处都配了"这条确实读到了东西"的正面断言
// （questionTypes 非空、averageMessageLength 不是兜底的 100、totalConversations 是真数）。
//
// 每个用例各建一个干净的库 + 干净的服务模块：`buildUserProfile()` 有 5 分钟模块级缓存，
// 而 `vi.resetModules()` 会连 `electron/database` 一起换新实例 —— 所以建库与注入都必须
// 走同一份新模块，不能沿用顶部的静态 import。

import { describe, it, expect, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import type { UserProfile } from '../electron/services/user-profile-service'

type Run = (text: string, params?: (string | number | null)[]) => void

async function freshWorld(): Promise<{
  buildUserProfile: () => Promise<UserProfile>
  hasUserProfile: () => boolean
  run: Run
  db: Database
}> {
  vi.resetModules()
  const dbMod = await import('../electron/database')
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  dbMod.injectTestDatabase(db)
  dbMod.applySchemaAndMigrations()
  const service = await import('../electron/services/user-profile-service')
  return {
    buildUserProfile: service.buildUserProfile,
    hasUserProfile: service.hasUserProfile,
    db,
    run: (text, params) => {
      db.run(text, params)
    },
  }
}

const LONG = ('什么是知行合一' + '行'.repeat(95)).slice(0, 100)

/**
 * 三本书：两本没写分类（应归"未分类"）、一本"心理学"；
 * 读完一本（progress 1）、读到一半一本（0.5）、没读一本（0.2 且很久没碰）。
 */
function seedBooks(run: Run): void {
  const now = Date.now()
  const day = 86400000
  const at = (msAgo: number) => new Date(now - msAgo).toISOString().replace('T', ' ').slice(0, 19)
  run(
    `INSERT INTO books (id, title, author, category, reading_progress, last_read_time) VALUES
     ('b_p1','认知','张三',NULL,1,?),
     ('b_p2','行为',NULL,  NULL,0.5,?),
     ('b_p3','情绪','张三','心理学',0.2,?)`,
    [at(day), at(2 * day), at(40 * day)]
  )
}

/** 一条带「」的划线：概念抽取要能从真实内容里认出「刻意练习」 */
function seedHighlight(run: Run): void {
  run(`INSERT INTO highlights (id, book_id, content) VALUES ('h_p1','b_p1',?)`, [
    '作者说「刻意练习」不重复，而是长期投入',
  ])
}

/**
 * 五张复习卡：2 张从未学过（state 0，due 已过）、1 张学习中到期、
 * 1 张复习态到期、1 张复习态未到期 —— 与 ReviewStats 对账那批同一套种子。
 */
function seedCards(run: Run): void {
  run(
    `INSERT INTO cards (id, highlight_id, state, due) VALUES
     ('c_p_new1','h_p1',0,datetime('now','-2 day')),
     ('c_p_new2','h_p1',0,datetime('now','-1 day')),
     ('c_p_learn','h_p1',1,datetime('now','-1 day')),
     ('c_p_rev','h_p1',2,datetime('now','-5 day')),
     ('c_p_future','h_p1',2,datetime('now','+3 day'))`
  )
}

/**
 * 12 场会话，把 created_at 与 updated_at 故意排成两种顺序：
 * c_01、c_02 最老创建、最新被改动。采样若按 updated_at 就会把这两场短会话抓进来。
 * 每场一条用户消息：c_03..c_12 各 100 字（含"什么是"），c_01/c_02 各 1 字。
 */
function seedConversations(run: Run): void {
  for (let i = 1; i <= 12; i++) {
    const id = `conv_p_${String(i).padStart(2, '0')}`
    const created = `2026-03-${String(i).padStart(2, '0')} 10:00:00`
    const updated = i <= 2 ? '2026-09-20 10:00:00' : `2026-03-${String(i).padStart(2, '0')} 12:00:00`
    run(
      `INSERT INTO conversations (id, title, created_at, updated_at, message_count) VALUES (?,?,?,?,1)`,
      [id, `会话 ${i}`, created, updated]
    )
    run(`INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?,?,?,?)`, [
      `msg_p_${i}`,
      id,
      'user',
      i <= 2 ? '好' : LONG,
    ])
  }
}

function seedAll(run: Run): void {
  seedBooks(run)
  seedHighlight(run)
  seedCards(run)
  seedConversations(run)
}

describe('用户画像服务对真实库', () => {
  it('书不够、会话也不够时如实说没有画像；够一项就算有', async () => {
    const { hasUserProfile, run } = await freshWorld()
    expect(hasUserProfile()).toBe(false)
    seedBooks(run)
    expect(hasUserProfile()).toBe(true) // 三本书就够，不需要十场会话

    const second = await freshWorld()
    seedConversations(second.run)
    expect(second.hasUserProfile()).toBe(true) // 十场会话也够，一本书都没有
  })

  it('阅读偏好读的是库里那一行：NULL 分类归"未分类"、进度与最近阅读时间各自算对', async () => {
    const { buildUserProfile, run } = await freshWorld()
    seedBooks(run)
    const prefs = (await buildUserProfile()).readingPreferences
    expect(prefs.favoriteCategories).toEqual([
      { category: '未分类', count: 2 },
      { category: '心理学', count: 1 },
    ])
    expect(prefs.favoriteAuthors).toEqual([
      { author: '张三', count: 2 },
      { author: '未知作者', count: 1 },
    ])
    // 三本里只有一本 progress >= 1
    expect(prefs.completionRate).toBeCloseTo(1 / 3, 10)
    // 最近 7 天内读过的只有两本（第三本 40 天前）→ weekly，不是 daily
    expect(prefs.readingFrequency).toBe('weekly')
  })

  it('知识图谱按分类汇总，掌握度取该分类最高的书、缺口如实列出', async () => {
    const { buildUserProfile, run } = await freshWorld()
    seedBooks(run)
    const { domains, gaps } = (await buildUserProfile()).knowledgeGraph
    expect(domains).toEqual([
      { domain: '未分类', mastery: 50 }, // max(100, 50) / 2 本
      { domain: '心理学', mastery: 20 },
    ])
    expect(gaps).toEqual(['心理学'])
  })

  it('认知层级走 cardsDb.getReviewStats 的真实口径（新卡不算已掌握）', async () => {
    const { buildUserProfile, run } = await freshWorld()
    seedBooks(run)
    seedHighlight(run)
    seedCards(run)
    const { overallScore, bloomDistribution, conceptMastery } = (
      await buildUserProfile()
    ).cognitiveLevel
    // 5 张卡里 review 态 2 张 ⇒ 40 分；两张从未学过的只进 remember
    expect(overallScore).toBe(40)
    expect(bloomDistribution).toEqual({
      remember: 2,
      understand: 2,
      apply: 1,
      analyze: 0,
      evaluate: 0,
      create: 0,
    })
    // 概念抽取读到了真实划线内容（不是 mock 的返回值）
    expect(conceptMastery.some((c) => c.concept.includes('刻意练习'))).toBe(true)
  })

  it('画像采样按 created_at 取最近十场，不按 updated_at（读口换了采样集合不许变）', async () => {
    const { buildUserProfile, run } = await freshWorld()
    seedAll(run)
    const profile = await buildUserProfile()
    // 按 created_at 取到的 10 场全是 100 字的长会话 ⇒ 平均 100；
    // 若换成 updated_at，那两场 1 字的会话会被抓进来，平均变成 80 → 'concise'
    expect(profile.learningStyle.responsePreference).toBe('detailed')
    expect(profile.learningStyle.interactionPattern).toBe('active')
    // 非空同时证明这里没走 try/catch 兜底（兜底给的是空数组）
    expect(profile.learningStyle.questionTypes).toEqual([
      'knowledge_query',
      'deep_discussion',
      'teaching_practice',
    ])
    // 会话模式扫的是全部 12 场：10×100 + 2×1 ⇒ 83.5 → 84（兜底值是 100 / 0）
    expect(profile.conversationPatterns.totalConversations).toBe(12)
    expect(profile.conversationPatterns.averageMessageLength).toBe(84)
  })
})
