// 记忆检索与保留上限（2026-09-28，真库）
//
// 起点是覆盖率清单里那两条：`memory-context-builder` **79.24 / 77.77**、
// `memory-service` **89.36 / 79.48**。AI 每轮对话都走这一条路（「调取知识库」里那块
// 「相关记忆」就是它），坏起来不报错，只是提示词里的东西不是宣称的那个东西。
//
// 判据走**真库**（生产的 `applySchemaAndMigrations()`），不是 mock：这一层要问的是
// 「库里到底有没有这一行、按什么顺序交回来」，mock 只证明服务按假数据算数。
//
// 本批两条生产缺陷都是在这里量出来的：
// ① `getRelevant` 的 ORDER BY 只有 `importance DESC` —— 界面那块叫「相关记忆」，
//    实际交回的是"含任一分词的行里最重要的 limit 条"。中文按 2 字滑窗分词，一个问句里
//    的常用二字组几乎什么都命中，于是"最相关"被悄悄换成"最重要"。
//    修法：召回仍是"命中任一分词"，排序按**命中的分词个数**（与 WHERE 同一个命中关系），
//    命中数相同再按重要度 —— 与 `services/global-search.ts` 的 `relevanceScore` 同一条口径
//    （「筛用的是哪个命中关系，排序就必须用同一个」）。
// ② LIKE 的 pattern 没转义也没有 `ESCAPE` —— `tokenize` 的 ASCII 词形如
//    `[a-z0-9][a-z0-9_-]*`，**下划线能直接进查询词**，于是查 `abc_def` 会命中 `abcdef`
//    （`_` 是单字符通配符）；`%` 进 db 层则命中所有行。
//    修法：改用 `src/shared/global-search.ts` 里那一份 `toLikePattern` + `ESCAPE '\'`
//    —— 全局搜索与生词本早就用它，这条通路一直各写一遍。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { memoriesDb, getDatabase } from '../electron/database'
import {
  getRelevantMemories,
  recordPreference,
  extractMemoriesFromConversation,
} from '../electron/services/memory-service'

const SOURCE = resolve(process.cwd(), 'electron/database/memories.ts')

/**
 * 种一行并保住 id。
 *
 * 写入走生产的 `memoriesDb.create`（列清单、默认值都归它），只是它自己生成 id，
 * 而排序类判据要按 id 点名"哪一条在前"，所以补一句按正文把 id 改成可读的名字。
 * `last_accessed_at` 同理：create 不带这一列（走库的 DEFAULT），要造"很久没被访问"只能改。
 */
function seed(
  id: string,
  content: string,
  opts: { importance?: number; lastAccessed?: string; type?: string } = {}
): void {
  memoriesDb.create({
    type: opts.type ?? 'preference',
    category: 'reading',
    content,
    importance: opts.importance,
  })
  const db = getDatabase()
  db.run(`UPDATE memories SET id = ? WHERE content = ?`, [id, content])
  if (opts.lastAccessed) {
    db.run(`UPDATE memories SET last_accessed_at = ? WHERE id = ?`, [opts.lastAccessed, id])
  }
}

const ids = (rows: Array<Record<string, unknown> | { id: string }>) =>
  rows.map((r) => String((r as { id?: unknown }).id))

beforeEach(async () => {
  await setupTestDatabase()
})

afterEach(() => {
  teardownTestDatabase()
})

describe('getRelevant 的排序：命中几个分词，就排在第几档', () => {
  it('命中两个词的那条，排在只命中一个但重要度更高的那条之前', () => {
    seed('one-hit', '每天坚持阅读三十分钟', { importance: 0.99 }) // 只命中「阅读」，重要度最高
    seed('two-hits', 'SQXW 阅读 方法 笔记', { importance: 0.1 }) // 命中「阅读」+「方法」，重要度最低
    expect(ids(getRelevantMemories('SQXW 阅读 方法', 3))).toEqual(['two-hits', 'one-hit'])
  })

  it('命中数相同时才轮到重要度（同档内倒序）', () => {
    seed('low', '关于 SQXW 的一条', { importance: 0.2 })
    seed('high', '关于 SQXW 的另一条', { importance: 0.8 })
    expect(ids(getRelevantMemories('SQXW', 3))).toEqual(['high', 'low'])
  })

  it('旧写法（排序里只有重要度）会被源码扫描逮住：这条判据不是空转', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).toContain('DESC, importance DESC LIMIT ?')
    expect(source).not.toMatch(/ORDER BY importance DESC LIMIT \?/)
  })
})

describe('getRelevant 的通配符：按字面匹配，不许当模式', () => {
  it('查询词里的下划线不许多匹配一个字符', () => {
    // 正文比查询词多出恰好一个字符：`_` 当通配符时这条会被命中，按字面匹配时不该
    seed('nodash', '这条写的是 abcXdef，没有下划线')
    expect(getRelevantMemories('abc_def', 3)).toEqual([])
  })

  it('百分号不许命中所有行（直接喂 db 层，分词器会把 % 丢掉）', () => {
    seed('plain', '达成率 100 分的一条，后面还有别的字')
    expect(memoriesDb.getRelevant(['100%'], 3)).toEqual([])
  })

  it('内容里真含下划线/百分号时才命中', () => {
    seed('real', '笔记里写了 abc_def 与 100%')
    expect(ids(getRelevantMemories('abc_def', 3))).toEqual(['real'])
    expect(ids(memoriesDb.getRelevant(['100%'], 3))).toEqual(['real'])
  })

  it('ASCII 大小写不同也能命中（LIKE 对 ASCII 本就不区分大小写）', () => {
    seed('case', 'Reading List 这条')
    expect(ids(getRelevantMemories('reading', 3))).toEqual(['case'])
  })

  it('同一把 LIKE 只许有一份：这条通路必须吃 global-search 的 pattern', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).toContain("from '../../src/shared/global-search'")
    // 反证：把值直接裹进 % 的旧写法不许回来
    expect(source).not.toMatch(/params\.push\(`%\$\{term\}%`\)/)
    expect(source).not.toContain('`%${term}%`')
  })
})

describe('检索的边界与副作用', () => {
  it('纯标点查询 ⇒ 回空数组，且一次库都不查', () => {
    seed('any', '任意一条记忆')
    expect(getRelevantMemories('！！！', 3)).toEqual([])
    expect(getRelevantMemories('？', 3)).toEqual([])
    // 没有分词就没有任何访问计数变化
    expect(memoriesDb.getAll().every((r) => r.access_count === 0)).toBe(true)
  })

  it('db 层直接喂空清单也必须回空（拼出来会是 `WHERE ` 语法错，不是空结果）', () => {
    seed('any', '任意一条记忆')
    expect(memoriesDb.getRelevant([], 3)).toEqual([])
  })

  it('只有真交回的那几条才计一次访问，被 limit 挡在外面的不许加', () => {
    seed('in-queue', 'SQXW 在清单里', { importance: 0.9 })
    seed('out-queue', 'SQXW 在清单外', { importance: 0.1 })
    expect(ids(getRelevantMemories('SQXW', 1))).toEqual(['in-queue'])
    const after = memoriesDb.getAll()
    expect(after.find((r) => r.id === 'in-queue')?.access_count).toBe(1)
    expect(after.find((r) => r.id === 'out-queue')?.access_count, '被截断的那条不该算作被访问过').toBe(0)
  })

  it('显式 0 的重要度就是 0，不许被 ?? 演成默认值', () => {
    // 单独一条：这条判据说的是"值本身"，不该被排序口径带着走
    seed('zero', '零重要度的一条', { importance: 0 })
    expect(getRelevantMemories('零重要度', 3)[0]?.importance).toBe(0)
  })

  it('没给重要度时吃库的 DEFAULT 0.5', () => {
    seed('dflt', '没给重要度的一条')
    expect(getRelevantMemories('没给重要度', 3)[0]?.importance).toBe(0.5)
  })
})

describe('保留上限：腾位置腾的是重要度最低、最久没被访问的那一条', () => {
  it('不足上限时一条都不许多删', () => {
    for (let i = 0; i < 5; i++) seed(`k-${i}`, `第 ${i} 条`)
    memoriesDb.deleteOldestBeyond(10)
    expect(memoriesDb.getAll()).toHaveLength(5)
  })

  it('同分里先删最久没被访问的', () => {
    seed('keep-high', '重要但很久没碰', { importance: 0.9, lastAccessed: '2020-01-01 00:00:00' })
    seed('drop-low', '不重要且很久没碰', { importance: 0.1, lastAccessed: '2020-01-01 00:00:00' })
    seed('keep-recent', '不重要但刚碰过', { importance: 0.1, lastAccessed: '2026-01-01 00:00:00' })
    memoriesDb.deleteOldestBeyond(2)
    const left = memoriesDb.getAll().map((r) => r.id)
    expect(left).toContain('keep-high')
    expect(left).toContain('keep-recent')
    expect(left, '同分里该被腾掉的是最久没被访问的那一条').not.toContain('drop-low')
  })

  it('记一条偏好就把总数压回上限以内', () => {
    for (let i = 0; i < 100; i++) seed(`fill-${i}`, `填充 ${i}`)
    recordPreference('reading', '第 101 条偏好')
    expect(memoriesDb.getAll()).toHaveLength(100)
    expect(memoriesDb.getAll().some((r) => r.content === '第 101 条偏好')).toBe(true)
  })
})

describe('记忆里能有哪些类型（库的 CHECK 就是真值）', () => {
  it('提取通路只会写 preference 与 insight 两类', () => {
    extractMemoriesFromConversation('我喜欢读认知科学类的书', '这一段没有洞察类句子。')
    extractMemoriesFromConversation(
      '为什么习惯这么难改',
      '原因是这样的：习惯的难点不在知识量，而在于每天重复的那条回路没有被替换掉。'
    )
    const types = new Set(memoriesDb.getAll().map((r) => r.type))
    expect([...types].sort()).toEqual(['insight', 'preference'])
  })

  it('回复里没有「20–50 字 + 句末标点」的句子时，一条洞察都不许写', () => {
    // 取句子靠 (.{20,50})[。！？]：太短或整段没有句末标点都取不出来，
    // 这时候宁可什么都不写，也不把半句话当"学习洞察"塞进提示词
    extractMemoriesFromConversation('随便说说', '原来如此')
    extractMemoriesFromConversation('随便说说', '原来如此，这就是原因')
    expect(memoriesDb.getAll()).toHaveLength(0)
  })

  it('设置页承诺过的 fact / feedback 两类，库里插不进去（CHECK 只认四种）', () => {
    // 反证：界面那三行规则原本写着"写入 fact 类型记忆""写入 feedback 类型记忆"，
    // 而生产代码从来没有任何地方产出它们 —— 因为库根本不接受。
    expect(() => memoriesDb.create({ type: 'fact', category: 'x', content: '一条事实' })).toThrow()
    expect(() => memoriesDb.create({ type: 'feedback', category: 'x', content: '一条反馈' })).toThrow()
    expect(memoriesDb.getAll(), '被拒之后库里不该有半行').toHaveLength(0)
  })
})
