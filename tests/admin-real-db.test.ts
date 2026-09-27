// 管理后台 × 真实数据库（2026-09-26）
//
// 为什么要真库：`electron/admin.ts` 全是直接写死列名的 SQL（`SELECT COUNT(*) FROM xxx`、
// 一段 LEFT JOIN 数划线、一条带 11 个列名的 knowledge_cards 查询）。这类 SQL 写错列名不会
// 有类型错误、也不会有编译警告 —— sqlite 在执行那一刻才报 `no such column`，而调用方一抛错
// 界面上就是"这一区空的"。后台的卡片区此前正是这么空着的（`getCardsByBook` 旧写法 JOIN 了
// 不存在的 `knowledge_cards.highlight_id`）。所以这一份用真库（生产 schema）把每条读数跑一遍。
//
// 提示词那一层用 mock：`prompt-storage` 自己另有 98% 覆盖的测试，这里要钉的只是
// "admin 的包装把参数原样转过去、结果原样交回来"，不需要再验它的存储逻辑。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

process.env.ZHIXING_TEST_PROFILE = 'user-data-admin-real-db'

const prompts = vi.hoisted(() => ({
  getAllPrompts: vi.fn(),
  getPromptTemplate: vi.fn((id: string) => `模板:${id}`),
  savePrompt: vi.fn(),
  resetPrompt: vi.fn(),
  resetAllPrompts: vi.fn(),
  exportPrompts: vi.fn(() => '[]'),
  importPrompts: vi.fn(),
  createCustomPrompt: vi.fn(),
  getAllCustomPrompts: vi.fn(),
  updateCustomPrompt: vi.fn(),
  deleteCustomPrompt: vi.fn(),
}))

vi.mock('../electron/services/prompt-storage', () => ({
  getAllPrompts: prompts.getAllPrompts,
  getPromptTemplate: prompts.getPromptTemplate,
  savePrompt: prompts.savePrompt,
  resetPrompt: prompts.resetPrompt,
  resetAllPrompts: prompts.resetAllPrompts,
  exportPrompts: prompts.exportPrompts,
  importPrompts: prompts.importPrompts,
  createCustomPrompt: prompts.createCustomPrompt,
  getAllCustomPrompts: prompts.getAllCustomPrompts,
  updateCustomPrompt: prompts.updateCustomPrompt,
  deleteCustomPrompt: prompts.deleteCustomPrompt,
}))

const intent = vi.hoisted(() => ({ getIntentKeywords: vi.fn(() => ({ review: ['复习'] })) }))
vi.mock('../electron/agent/intent-classifier', () => ({ getIntentKeywords: intent.getIntentKeywords }))

import { getDatabase } from '../electron/database'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import * as admin from '../electron/admin'

type Row = Record<string, unknown>

function run(sql: string): void {
  getDatabase().run(sql)
}

function query(sql: string): Row[] {
  const res = getDatabase().exec(sql)
  if (res.length === 0) return []
  const { columns, values } = res[0]
  return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}

/** 每轮从同一份种子开始（有一条用例要把库清空，不能靠"跑一次就好了"的顺序） */
function seedWorld(): void {
  for (const t of [
    'chat_messages', 'conversations', 'reviews', 'ai_generation_batches', 'cards',
    'knowledge_cards', 'token_usage', 'highlights', 'books',
  ]) run(`DELETE FROM ${t}`)
  // 书：b2 的 updated_at 最新（列表第一条），b3 一条划线都没有
  run(`INSERT INTO books (id,title,author,updated_at,reading_progress) VALUES
        ('b1','活着','余华','2026-05-01 10:00:00',0.5),
        ('b2','穷查理宝典','查理·芒格','2026-06-01 10:00:00',1),
        ('b3','没有划线的书','某人','2026-01-01 10:00:00',0)`)
  run(`INSERT INTO highlights (id,book_id,content,created_at) VALUES
        ('h1','b1','第一句','2026-05-01 09:00:00'),
        ('h2','b1','第二句','2026-05-02 09:00:00'),
        ('h3','b1','第三句','2026-05-03 09:00:00'),
        ('h4','b2','宝典的一句','2026-06-01 09:00:00')`)
  run(`INSERT INTO knowledge_cards (id,book_id,type,title,content,source_highlight_id,created_at) VALUES
        ('kc1','b1','concept','认知','内容A','h1','2026-05-04 09:00:00'),
        ('kc2','b1','quote','金句','内容B',NULL,'2026-05-05 09:00:00')`)
  // 复习卡片是另一张表：后台那张「知识卡片」KPI 数的必须是 knowledge_cards，不是 cards
  run(`INSERT INTO cards (id,highlight_id,state,due) VALUES
        ('rc1','h1',1,'2099-01-01 00:00:00'),
        ('rc2','h2',1,'2099-01-01 00:00:00'),
        ('rc3','h3',1,'2099-01-01 00:00:00'),
        ('rc4','h4',1,'2099-01-01 00:00:00'),
        ('rc5','h4',1,'2099-01-01 00:00:00')`)
  // 会话：c1 那行的 message_count 列故意与真实条数不一致，看后台信哪个
  run(`INSERT INTO conversations (id,title,book_id,updated_at,message_count) VALUES
        ('conv1','关于活着','b1','2026-06-02 10:00:00',99),
        ('conv2','没关联书',NULL,'2026-04-02 10:00:00',0)`)
  run(`INSERT INTO chat_messages (id,conversation_id,role,content,created_at) VALUES
        ('m1','conv1','user','最早的提问','2026-06-01 08:00:00'),
        ('m2','conv1','assistant','回答','2026-06-01 09:00:00'),
        ('m3','conv1','user','最近的追问','2026-06-02 09:00:00'),
        ('m4','conv2','user','只有一条','2026-04-02 09:00:00')`)
  // Token：今天两行（同一组）、6 天前一行（在 7 天窗口内）、9 天前一行（必须被窗口挡住）
  run(`INSERT INTO token_usage (id,provider,model,feature,input_tokens,output_tokens,total_tokens,created_at)
        VALUES ('t1','deepseek','m','chat',100,50,150,datetime('now')),
               ('t2','deepseek','m','summary',10,5,15,datetime('now')),
               ('t3','openai','m','chat',7,3,10,datetime('now','-6 days')),
               ('t4','openai','m','chat',1000,1000,2000,datetime('now','-9 days'))`)
}

beforeAll(async () => {
  await setupTestDatabase()
})

beforeEach(() => {
  seedWorld()
})

afterAll(() => {
  teardownTestDatabase()
})

describe('getAdminStats — 概览页那六个数字各自数的是哪张表', () => {
  it('每个数都等于种下去的真值', () => {
    expect(admin.getAdminStats()).toMatchObject({
      totalConversations: 2,
      totalMessages: 4,
      totalBooks: 3,
      totalHighlights: 4,
      totalCards: 2,
    })
  })

  it('「知识卡片」数的是 knowledge_cards，不是复习卡片表 cards（后者 5 张）', () => {
    const stats = admin.getAdminStats()
    expect(stats.totalCards).toBe(2)
    expect(query('SELECT COUNT(*) as n FROM cards')[0].n).toBe(5)
    expect(query('SELECT COUNT(*) as n FROM knowledge_cards')[0].n).toBe(2)
  })

  it('「总 Token」是全时段累计，不跟着近 7 天那个窗口走', () => {
    // 150 + 15 + 10 + 2000：连 9 天前那条也在内 —— 卡片标题写的是「总 Token」
    expect(admin.getAdminStats().totalTokens).toBe(2175)
  })

  it('空库里全是 0，不报 undefined 也不报错', () => {
    for (const sql of [
      'DELETE FROM chat_messages', 'DELETE FROM conversations', 'DELETE FROM token_usage',
      'DELETE FROM highlights', 'DELETE FROM knowledge_cards', 'DELETE FROM cards', 'DELETE FROM books',
    ]) run(sql)
    expect(admin.getAdminStats()).toEqual({
      totalConversations: 0, totalMessages: 0, totalTokens: 0,
      totalBooks: 0, totalHighlights: 0, totalCards: 0,
    })
  })
})

describe('getTokenUsageLast7Days — 窗口边界', () => {
  it('同一天的多行合并成一组，input/output/total 各自相加', () => {
    const today = query("SELECT DATE('now') as d")[0].d as string
    const rows = admin.getTokenUsageLast7Days()
    const mine = rows.find(r => r.date === today)
    expect(mine).toMatchObject({ inputTokens: 110, outputTokens: 55, totalTokens: 165 })
  })

  it('9 天前那行不进窗口，6 天前那行进；结果按日期升序', () => {
    const rows = admin.getTokenUsageLast7Days()
    const dates = rows.map(r => r.date)
    expect(dates).toEqual([...dates].sort())
    const cut = query("SELECT DATE('now','-9 days') as d")[0].d as string
    expect(dates).not.toContain(cut)
    expect(rows.reduce((s, r) => s + r.totalTokens, 0)).toBe(175)
  })
})

describe('知识库页的三份读数', () => {
  it('按书列划线数：没有划线的书是 0，不是缺字段；顺序按最后更新时间倒序', () => {
    const rows = admin.getBooksWithCounts()
    expect(rows.map(r => r.id)).toEqual(['b2', 'b1', 'b3'])
    const counts = Object.fromEntries(rows.map(r => [r.id, r.highlight_count]))
    expect(counts).toEqual({ b1: 3, b2: 1, b3: 0 })
  })

  it('按本取划线：只给这一本的，按时间倒序；未知 id 给空数组', () => {
    const ids = admin.getHighlightsByBook('b1').map(r => r.id)
    expect(ids).toEqual(['h3', 'h2', 'h1'])
    expect(admin.getHighlightsByBook('不存在')).toEqual([])
  })

  it('按本取知识卡片：SQL 里列出的每个列名都真的存在于这张表', () => {
    const cards = admin.getCardsByBook('b1')
    expect(cards).toHaveLength(2)
    // 这条同时是历史回归：旧写法 JOIN 了不存在的 knowledge_cards.highlight_id ⇒ 整块抛错
    expect(Object.keys(cards[0]).sort()).toEqual([
      'application', 'book_id', 'content', 'created_at', 'id', 'interpretation',
      'mastery_level', 'review_count', 'source_highlight_id', 'title', 'type',
    ])
    expect(cards.map(c => c.id)).toEqual(['kc2', 'kc1'])
  })
})

describe('会话历史页', () => {
  it('消息数按真实消息重算，不信 conversations.message_count 那一列', () => {
    const sessions = admin.getAdminSessions()
    const first = sessions.find(s => s.id === 'conv1')
    expect(first?.message_count).toBe(3)
    expect(query("SELECT message_count as n FROM conversations WHERE id='conv1'")[0].n).toBe(99)
  })

  it('带上关联书籍的标题；没有 book_id 的会话也要列出来（标题为空）', () => {
    const byId = Object.fromEntries(admin.getAdminSessions().map(s => [s.id, s]))
    expect(byId.conv1.book_title).toBe('活着')
    expect(byId.conv2).toBeDefined()
    expect(byId.conv2.book_title ?? null).toBeNull()
  })

  it('单个会话的消息按时间正序（读对话要顺着读）', () => {
    const msgs = admin.getAdminSessionMessages('conv1')
    expect(msgs.map(m => m.content)).toEqual(['最早的提问', '回答', '最近的追问'])
    expect(admin.getAdminSessionMessages('不存在')).toEqual([])
  })
})

describe('getAgentConfig — 运行时真实生效值', () => {
  it('系统提示词取 prompt-storage 的模板，意图关键词取 intent-classifier', () => {
    expect(admin.getAgentConfig()).toEqual({
      systemPrompt: '模板:agent.system',
      intentKeywords: { review: ['复习'] },
    })
  })

  it('模板缺失时交回 null，不是一条空字符串（界面据此区分"没有"与"空"）', () => {
    prompts.getPromptTemplate.mockReturnValueOnce('')
    expect(admin.getAgentConfig().systemPrompt).toBeNull()
  })
})

describe('数据库浏览器', () => {
  it('列出全部业务表，且不含 sqlite_ 内部表', () => {
    const tables = admin.getDatabaseSchema()
    expect(tables.length).toBeGreaterThanOrEqual(17)
    expect(tables.map(t => t.name)).not.toContain('sqlite_master')
    expect(tables.every(t => t.sql.length > 0)).toBe(true)
    expect(tables.map(t => t.name)).toEqual([...tables.map(t => t.name)].sort())
  })

  it('取表数据带得出列名与总数，并真按 limit/offset 翻页', () => {
    const page1 = admin.getDatabaseTableData('books', 2, 0)
    expect(page1.total).toBe(3)
    expect(page1.rows).toHaveLength(2)
    expect(page1.columns).toContain('title')
    const page2 = admin.getDatabaseTableData('books', 2, 2)
    expect(page2.rows).toHaveLength(1)
    // 两页不重不漏
    const ids = [...page1.rows, ...page2.rows].map(r => r.id).sort()
    expect(ids).toEqual(['b1', 'b2', 'b3'])
  })

  it('默认每页 50 条（不传 limit 时页面不用自己填）', () => {
    expect(admin.getDatabaseTableData('knowledge_cards').rows).toHaveLength(2)
  })

  it('空表返回空列名而不是崩（没数据的表也要能点开）', () => {
    const empty = admin.getDatabaseTableData('ai_generation_batches')
    expect(empty).toEqual({ columns: [], rows: [], total: 0 })
  })

  it('表名要拼进 SQL，所以非法名字一律拒：内部表、带空格分号、被改写过、空串', () => {
    for (const bad of ['sqlite_master', 'books; DROP TABLE books', 'bo ks', '']) {
      expect(() => admin.getDatabaseTableData(bad), bad).toThrow('Invalid table name')
    }
    // 拒了之后数据原样还在（不是"报错了但已经改了一半"）
    expect(admin.getDatabaseTableData('books').total).toBe(3)
  })
})

describe('提示词相关的包装：只做转发，别在这里加逻辑', () => {
  const builtin = [
    { id: 'agent.system', isCustom: false },
    { id: 'chat.default', isCustom: false },
  ]
  const custom = [{ id: 'cp1', isCustom: true, name: '我的模板' }]

  it('列表 = 内置 + 自定义一起交出', () => {
    prompts.getAllPrompts.mockReturnValue([...builtin, ...custom])
    expect(admin.getAllAdminPrompts()).toHaveLength(3)
    expect(prompts.getAllPrompts).toHaveBeenCalledTimes(1)
  })

  it('保存 / 重置 / 导入 把参数原样交给 prompt-storage，并原样回传结果', () => {
    const saved = { success: true }
    prompts.savePrompt.mockReturnValue(saved)
    expect(admin.saveAdminPrompt('agent.system', '新模板')).toBe(saved)
    expect(prompts.savePrompt).toHaveBeenCalledWith('agent.system', '新模板')

    const reset = { success: true }
    prompts.resetPrompt.mockReturnValue(reset)
    expect(admin.resetAdminPrompt('agent.system')).toBe(reset)
    expect(prompts.resetPrompt).toHaveBeenCalledWith('agent.system')

    const imported = { success: true, imported: 2 }
    prompts.importPrompts.mockReturnValue(imported)
    expect(admin.importAdminPrompts('{"a":1}')).toBe(imported)
    expect(prompts.importPrompts).toHaveBeenCalledWith('{"a":1}')

    expect(admin.exportAdminPrompts()).toBe('[]')
  })

  it('「全部重置」报的是清掉的自定义模板条数，不是内置数量', () => {
    prompts.getAllPrompts.mockReturnValue([...builtin, ...custom, { id: 'cp2', isCustom: true }])
    expect(admin.resetAllAdminPrompts()).toEqual({ success: true, count: 2 })
    expect(prompts.resetAllPrompts).toHaveBeenCalledTimes(1)
  })

  it('自定义模板的增删改查同样只是转发', () => {
    const created = { id: 'cp9', name: '新模板' }
    prompts.createCustomPrompt.mockReturnValue(created)
    expect(admin.createAdminCustomPrompt('新模板', '内容')).toBe(created)
    expect(prompts.createCustomPrompt).toHaveBeenCalledWith('新模板', '内容')

    const list = [created]
    prompts.getAllCustomPrompts.mockReturnValue(list)
    expect(admin.getAllAdminCustomPrompts()).toBe(list)

    const updated = { success: true }
    prompts.updateCustomPrompt.mockReturnValue(updated)
    expect(admin.updateAdminCustomPrompt('cp9', '改名', '新内容')).toBe(updated)
    expect(prompts.updateCustomPrompt).toHaveBeenCalledWith('cp9', '改名', '新内容')

    const removed = { success: true }
    prompts.deleteCustomPrompt.mockReturnValue(removed)
    expect(admin.deleteAdminCustomPrompt('cp9')).toBe(removed)
    expect(prompts.deleteCustomPrompt).toHaveBeenCalledWith('cp9')
  })
})
