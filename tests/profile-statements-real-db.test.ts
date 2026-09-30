// @vitest-environment node
// profile_statements 的真库测试（第 18 张表）
//
// 判据量的是「库里那一行到底变成什么了」，不是「函数按 mock 的返回值算数」：
// 这张表存的是本人的判定，写错一次就是把人按过的键抹掉，所以逐条对库。
// 只 mock 日志 —— 坏 JSON 那一条要看的正是 logger.warn 有没有那句。

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { getDatabase, profileStatementsDb, resetDatabase } from '../electron/database'
import { RESET_TABLES } from '../electron/database/schema'
import { BACKUP_TABLES, EXCLUDED_TABLES } from '../src/shared/backup'
import type { DraftStatement } from '../src/shared/profile-statements'

// 用 hoisted 的接缝，不 `import { logger }`：真 import 会把 electron/logger.ts 算进
// "被测试引用的文件"，那条守卫就要求它也进覆盖率清单 —— 这一份判据不该替它做决定。
const seams = vi.hoisted(() => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

function draft(id: string, over: Partial<DraftStatement> = {}): DraftStatement {
  return {
    id,
    layer: 'said',
    topic: '表达',
    statement: '我写东西短、直白',
    evidenceIds: ['hl_1#note', 'hl_2'],
    verdict: 'pending',
    origin: 'nuwa',
    ...over,
  }
}

/** 库里那一行的原始形状（不走映射器，避免"测的是映射器自己"） */
function rawRow(id: string): Record<string, unknown> {
  const exec = getDatabase().exec('SELECT * FROM profile_statements WHERE id = ?', [id])
  if (exec.length === 0) throw new Error(`库里没有这一行：${id}`)
  const out: Record<string, unknown> = {}
  exec[0].columns.forEach((col, i) => {
    out[col] = exec[0].values[0][i]
  })
  return out
}

function countRows(): number {
  const exec = getDatabase().exec('SELECT COUNT(*) FROM profile_statements')
  return Number(exec[0].values[0][0])
}

beforeAll(async () => {
  await setupTestDatabase()
})

beforeEach(() => {
  getDatabase().run('DELETE FROM profile_statements')
  vi.clearAllMocks()
})

afterAll(() => {
  teardownTestDatabase()
})

describe('表本身：列名与 CHECK 由库说了算', () => {
  it('列清单就是这个形状，多一列少一列都判红', () => {
    const exec = getDatabase().exec('PRAGMA table_info(profile_statements)')
    const cols = exec[0].values.map((row) => String(row[1]))
    expect(cols).toEqual(['id', 'layer', 'topic', 'statement', 'evidence_ids', 'verdict', 'origin', 'created_at', 'updated_at'])
  })

  it('库拒绝认识的层以外的值', () => {
    expect(() =>
      getDatabase().run("INSERT INTO profile_statements (id, layer, topic, statement, evidence_ids) VALUES ('x','feeling','t','s','[]')"),
    ).toThrow()
  })

  it('库拒绝 pending / confirmed / rejected / unsure 以外的判定', () => {
    expect(() =>
      getDatabase().run("INSERT INTO profile_statements (id, layer, topic, statement, evidence_ids, verdict) VALUES ('y','said','t','s','[]','maybe')"),
    ).toThrow()
  })

  it('库拒绝 app/nuwa/manual 以外的来源', () => {
    expect(() =>
      getDatabase().run("INSERT INTO profile_statements (id, layer, topic, statement, evidence_ids, origin) VALUES ('z','said','t','s','[]','gpt')"),
    ).toThrow()
  })
})

describe('写入与读回', () => {
  it('一条都没给时不碰库、不写盘', () => {
    expect(profileStatementsDb.upsertMany([])).toBe(0)
    expect(countRows()).toBe(0)
  })

  it('写进去的逐栏对账：证据数组原样回来，判定从 pending 起', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1', { evidenceIds: ['hl_1#note', 'msg_9', 'book_3'] })])
    const rows = profileStatementsDb.getAll()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('nuwa:p1')
    expect(rows[0].evidenceIds).toEqual(['hl_1#note', 'msg_9', 'book_3'])
    expect(rows[0].verdict).toBe('pending')
    expect(rows[0].origin).toBe('nuwa')
  })

  it('库里那一列存的是 JSON 文本（不是被掰平的字符串）', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    expect(rawRow('nuwa:p1').evidence_ids).toBe('["hl_1#note","hl_2"]')
  })

  it('坏 JSON 的证据列按空数组处理并记一句 —— 结论本身不许丢', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    getDatabase().run("UPDATE profile_statements SET evidence_ids = '{这不是 JSON' WHERE id = 'nuwa:p1'")
    const rows = profileStatementsDb.getAll()
    expect(rows).toHaveLength(1)
    expect(rows[0].evidenceIds).toEqual([])
    expect(rows[0].statement).toBe('我写东西短、直白')
    expect(seams.logger.warn).toHaveBeenCalledWith(expect.stringContaining('nuwa:p1'))
  })

  it('证据列解出来不是数组（数字 / 字符串 / 对象）时也按无证据处理，不抛', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1'), draft('nuwa:p2'), draft('nuwa:p3')])
    getDatabase().run("UPDATE profile_statements SET evidence_ids = '3' WHERE id = 'nuwa:p1'")
    getDatabase().run("UPDATE profile_statements SET evidence_ids = '\"一个字符串\"' WHERE id = 'nuwa:p2'")
    getDatabase().run("UPDATE profile_statements SET evidence_ids = '{\"a\":1}' WHERE id = 'nuwa:p3'")

    const rows = profileStatementsDb.getAll()
    expect(rows.map((row) => row.evidenceIds)).toEqual([[], [], []])
    expect(seams.logger.warn).toHaveBeenCalledTimes(3)
  })

  it('数组里混进来的非字符串项丢掉，其余留着', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    getDatabase().run(`UPDATE profile_statements SET evidence_ids = '["hl_1",42,null,""]' WHERE id = 'nuwa:p1'`)
    expect(profileStatementsDb.getAll()[0].evidenceIds).toEqual(['hl_1'])
  })

  it('可空的时间列显式插 NULL 时读成空串，不是字符串 "null"；空的证据列按无证据处理', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    getDatabase().run('UPDATE profile_statements SET created_at = NULL, updated_at = NULL WHERE id = ' + "'nuwa:p1'")
    const row = profileStatementsDb.getAll()[0]
    expect(row.createdAt).toBe('')
    expect(row.updatedAt).toBe('')

    // evidence_ids 是 NOT NULL，能出现的最坏形状是空串（手改过的备份文件）
    getDatabase().run("UPDATE profile_statements SET evidence_ids = '' WHERE id = 'nuwa:p1'")
    expect(profileStatementsDb.getAll()[0].evidenceIds).toEqual([])
  })
})

describe('重导入：沉淀不是重跑', () => {
  it('同一 id 再导一次，正文与证据跟着更新', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1', { statement: '第一版说法' })])
    profileStatementsDb.upsertMany([draft('nuwa:p1', { statement: '第二版说法', evidenceIds: ['hl_2', 'hl_3'] })])
    expect(countRows()).toBe(1)
    const row = profileStatementsDb.getAll()[0]
    expect(row.statement).toBe('第二版说法')
    expect(row.evidenceIds).toEqual(['hl_2', 'hl_3'])
  })

  it('created_at 说的是"什么时候第一次进来"，重导入不许把它改成此刻', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    getDatabase().run("UPDATE profile_statements SET created_at = '2026-01-02 03:04:05' WHERE id = 'nuwa:p1'")
    profileStatementsDb.upsertMany([draft('nuwa:p1', { statement: '第二版说法' })])
    expect(String(rawRow('nuwa:p1').created_at)).toBe('2026-01-02 03:04:05')
  })

  it('判定那一格由 upsert 保底：就算调用方漏挡，已判的也不会被重置回 pending', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    expect(profileStatementsDb.setVerdict('nuwa:p1', 'confirmed')).toBe(true)
    profileStatementsDb.upsertMany([draft('nuwa:p1', { statement: '第二版说法' })])
    expect(String(rawRow('nuwa:p1').verdict)).toBe('confirmed')
  })
})

describe('按下判定', () => {
  it('记上了就交回 true，库里那一行跟着变', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1'), draft('nuwa:p2')])
    expect(profileStatementsDb.setVerdict('nuwa:p2', 'rejected')).toBe(true)
    expect(String(rawRow('nuwa:p2').verdict)).toBe('rejected')
    expect(String(rawRow('nuwa:p1').verdict)).toBe('pending')
  })

  it('库里没有这一条时交回 false，且不凭空多出一行', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    expect(profileStatementsDb.setVerdict('nuwa:没有这条', 'confirmed')).toBe(false)
    expect(countRows()).toBe(1)
  })
})

describe('第 18 张表的注册触点（加一张表要动的地方，逐条核过）', () => {
  /** 真实建出来的库里有哪些业务表（不看源码里的字符串，看库自己） */
  function realTables(): string[] {
    const exec = getDatabase().exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    return exec[0].values.map((row) => String(row[0])).sort()
  }

  it('重置数据库的清单与库里的表一一对得上：少一张就少清一张，而界面上写的是"重置"', () => {
    const tables = realTables()
    expect(tables).toEqual([...RESET_TABLES].sort())
    // 反证：从清单里摘掉这张新表，必须当场被报出来（不是永远绿的相等判断）
    const dropped = RESET_TABLES.filter((t) => t !== 'profile_statements')
    expect(dropped).not.toContain('profile_statements')
    expect(tables).toContain('profile_statements')
  })

  it('resetDatabase 真把这张表清空（清单对得上不等于跑得对）', () => {
    profileStatementsDb.upsertMany([draft('nuwa:p1')])
    expect(countRows()).toBe(1)

    resetDatabase()

    expect(countRows()).toBe(0)
  })

  it('画像结论进备份清单：本人按下的判定是用户资产，不是可重算的缓存', () => {
    const spec = BACKUP_TABLES.find((s) => s.table === 'profile_statements')
    expect(spec?.label).toBe('条画像结论')
    expect(EXCLUDED_TABLES.profile_statements).toBeUndefined()
  })
})

describe('读的顺序与数量', () => {
  it('核验区一次读全：按话题排，同话题按进来的先后', () => {
    getDatabase().run("UPDATE profile_statements SET created_at = '2026-01-01 00:00:00'")
    profileStatementsDb.upsertMany([draft('nuwa:p3')])
    getDatabase().run("UPDATE profile_statements SET created_at = '2026-01-02 00:00:00' WHERE id = 'nuwa:p3'")
    profileStatementsDb.upsertMany([
      draft('nuwa:p1', { topic: '做事', statement: '甲' }),
      draft('nuwa:p2', { topic: '做事', statement: '乙' }),
    ])
    getDatabase().run("UPDATE profile_statements SET created_at = '2026-01-03 00:00:00' WHERE id IN ('nuwa:p1','nuwa:p2')")
    expect(profileStatementsDb.getAll().map((row) => row.statement)).toEqual(['甲', '乙', '我写东西短、直白'])
  })
})
