// @vitest-environment node
/**
 * profile-statements — 「画像结论」进库前的唯一一道闸（纯函数）
 *
 * 判的是什么：外部 AI 写出的结论文件（或手工整理的那份）能不能变成库里那一行。
 * 三条不许含糊：
 * - **证据必须真在语料里、而且至少两条**：一条孤证撑不起一句关于你的结论（方案书 §2.5），
 *   对不上库里那一行的 id 更不能收 —— 收了以后界面上的「回原文」点不到东西。
 * - **判定只能由本人按下**：文件里写 `verdict` 一律无效，导入的行永远是 `pending`。
 * - **重导入不许无声覆盖已有的判定**：已经点过「对」的结论，再导一次不能悄悄改掉。
 *
 * 坏的那一条丢掉并说明原因，其余照常进 —— 与知识卡片 `steps` 坏 JSON 同一降级口径。
 */
import { describe, expect, it } from 'vitest'
import {
  PROFILE_STATEMENT_LAYERS,
  STATEMENT_FILE_APP,
  STATEMENT_FILE_VERSION,
  describeBadFile,
  describeStatementImport,
  mergeStatementsForWrite,
  parseStatementsFile,
  statementRowId,
  validateStatements,
} from '../src/shared/profile-statements'
import type { RejectReason, StatementOrigin, StatementsFile } from '../src/shared/profile-statements'

const KNOWN = new Set(['hl_1', 'hl_1#note', 'hl_2', 'hl_3', 'msg_1', 'book_9'])

const file = (statements: unknown[], origin: StatementOrigin = 'nuwa'): StatementsFile => ({
  app: STATEMENT_FILE_APP,
  version: STATEMENT_FILE_VERSION,
  origin,
  statements,
})

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  layer: 'said',
  topic: '表达',
  statement: '我写东西短、直白',
  evidenceIds: ['hl_1#note', 'hl_2'],
  ...over,
})

describe('读文件那一步：认不出形状就不往下走', () => {
  it('认得的形状交回原文', () => {
    const parsed = parseStatementsFile(JSON.stringify(file([row()])))
    expect(parsed.ok).toBe(true)
  })

  it('坏 JSON 说的不是「没有结论」', () => {
    const parsed = parseStatementsFile('{这不是 JSON')
    expect(parsed).toEqual({ ok: false, reason: 'bad_json' })
  })

  it('不是本应用的画像文件', () => {
    const other = { ...file([row()]), app: 'some-other-app' }
    expect(parseStatementsFile(JSON.stringify(other))).toEqual({ ok: false, reason: 'wrong_app' })
  })

  it('版本比程序还新时不猜', () => {
    const newer = { ...file([row()]), version: '9.9' }
    expect(parseStatementsFile(JSON.stringify(newer))).toEqual({ ok: false, reason: 'bad_version' })
  })

  it('来源不合法时不猜一个', () => {
    const bad = { ...file([row()]), origin: 'gpt' }
    expect(parseStatementsFile(JSON.stringify(bad))).toEqual({ ok: false, reason: 'bad_origin' })
  })

  it('statements 不是数组 ⇒ 不是「这份文件没有结论」', () => {
    const bad = { ...file([]), statements: { nope: true } }
    expect(parseStatementsFile(JSON.stringify(bad))).toEqual({ ok: false, reason: 'bad_statements' })
  })

  it('空的数组是合法的（合规格但一条结论都没有）', () => {
    const parsed = parseStatementsFile(JSON.stringify(file([])))
    expect(parsed.ok === true && parsed.file.statements).toEqual([])
  })

  it('认不出文件时说的是人话，不是内部键名', () => {
    for (const reason of ['bad_json', 'wrong_app', 'bad_version', 'bad_origin', 'bad_statements'] as const) {
      const text = describeBadFile(reason)
      expect(text).not.toContain(reason)
      expect(text).not.toContain('undefined')
      expect(text.length).toBeGreaterThan(10)
    }
    // 拒收的两种最常见情形要当场说清"库里没动"
    expect(describeBadFile('bad_json')).toContain('库里什么都没改')
    expect(describeBadFile('wrong_app')).toContain('库里什么都没改')
  })
})

describe('逐条校验：不合的那一条丢，其余照常进', () => {
  it('两条真证据 ⇒ 收', () => {
    const out = validateStatements([row()], KNOWN)
    expect(out.accepted).toHaveLength(1)
    expect(out.rejected).toEqual([])
  })

  it('只有一条证据 ⇒ 丢，且说的是同一条正向对照收得下', () => {
    const one = validateStatements([row({ evidenceIds: ['hl_1#note'] })], KNOWN)
    expect(one.rejected).toEqual([{ id: 'p1', reason: 'too_few_evidence' }])
    expect(one.accepted).toEqual([])
    const two = validateStatements([row({ evidenceIds: ['hl_1#note', 'hl_2'] })], KNOWN)
    expect(two.accepted).toHaveLength(1)
  })

  it('证据 id 对不上语料 ⇒ 丢（正向对照：换成真 id 就收）', () => {
    const out = validateStatements([row({ evidenceIds: ['hl_1#note', 'hl_404'] })], KNOWN)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'unknown_evidence' }])
    expect(validateStatements([row()], KNOWN).accepted).toHaveLength(1)
  })

  it('重复的 id 只算一条证据', () => {
    const out = validateStatements([row({ evidenceIds: ['hl_1#note', 'hl_1#note'] })], KNOWN)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'too_few_evidence' }])
  })

  it('非字符串的证据 id 不算证据（正向对照：两条字符串就收）', () => {
    const out = validateStatements([row({ evidenceIds: ['hl_1#note', 42, null, ''] })], KNOWN)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'too_few_evidence' }])
  })

  it('inferred 这一层没有生产者 ⇒ 一条都不许进', () => {
    const out = validateStatements([row({ layer: 'inferred' })], KNOWN)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'inferred_disabled' }])
    // 正向对照：同一份只改层名就收得下
    expect(validateStatements([row({ layer: 'marked' })], KNOWN).accepted).toHaveLength(1)
  })

  it('层名不认识的 ⇒ 丢并说清认得哪些', () => {
    expect(PROFILE_STATEMENT_LAYERS).toEqual(['said', 'marked', 'chose'])
    const out = validateStatements([row({ layer: 'feeling' })], KNOWN)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'bad_layer' }])
  })

  it('正文 / 话题 / id 为空 ⇒ 各丢各的', () => {
    expect(validateStatements([row({ statement: '   ' })], KNOWN).rejected).toEqual([
      { id: 'p1', reason: 'blank_statement' },
    ])
    expect(validateStatements([row({ topic: '' })], KNOWN).rejected).toEqual([
      { id: 'p1', reason: 'blank_topic' },
    ])
    expect(validateStatements([row({ id: '' })], KNOWN).rejected).toEqual([
      { id: '(缺 id)', reason: 'blank_id' },
    ])
  })

  it('不是对象的那一条丢，不整批崩', () => {
    const out = validateStatements([row(), '我不是对象', null], KNOWN)
    expect(out.accepted).toHaveLength(1)
    expect(out.rejected).toEqual([
      { id: '(缺 id)', reason: 'not_an_object' },
      { id: '(缺 id)', reason: 'not_an_object' },
    ])
  })

  it('文件里写 verdict 无效 ⇒ 落库前永远是 pending（判定只能由本人按下）', () => {
    const out = validateStatements([row({ verdict: 'confirmed' })], KNOWN)
    expect(out.accepted[0].verdict).toBe('pending')
  })

  it('同一份文件里重复的 id ⇒ 第二条丢，第一条留', () => {
    const out = validateStatements([row(), row({ statement: '另一句', evidenceIds: ['hl_2', 'hl_3'] })], KNOWN)
    expect(out.accepted).toHaveLength(1)
    expect(out.rejected).toEqual([{ id: 'p1', reason: 'duplicate_id' }])
  })

  it('落库行 id 带来源命名空间 ⇒ 同编号不同来源不互相顶掉', () => {
    expect(statementRowId('nuwa', 'p1')).toBe('nuwa:p1')
    expect(statementRowId('manual', 'p1')).toBe('manual:p1')
    const nuwa = validateStatements([row()], KNOWN).accepted[0]
    const manual = validateStatements([row()], KNOWN, 'manual').accepted[0]
    expect(nuwa.id).not.toBe(manual.id)
  })

  it('分母不能漏项：每一条要么进 accepted 要么进 rejected', () => {
    const raw = [row(), row({ id: 'p2' }), row({ id: 'p3', evidenceIds: ['hl_1#note'] }), '坏的一条']
    const out = validateStatements(raw, KNOWN)
    expect(out.accepted.length + out.rejected.length).toBe(4)
  })
})

describe('重导入不许无声覆盖已有判定', () => {
  const accepted = (id: string, statement = '我写东西短'): Record<string, unknown>[] => [
    { id, layer: 'said', topic: '表达', statement, evidenceIds: ['hl_1#note', 'hl_2'], verdict: 'pending' },
  ]

  it('库里已经点过「对」的 ⇒ 这一条不写，报出来', () => {
    const existing = { 'nuwa:p1': { verdict: 'confirmed' as const } }
    const plan = mergeStatementsForWrite(accepted('nuwa:p1') as never, existing)
    expect(plan.toWrite).toEqual([])
    expect(plan.protectedIds).toEqual(['nuwa:p1'])
  })

  it('点过「不对」的同样保留（推翻本人按下的「不对」也是覆盖）', () => {
    const plan = mergeStatementsForWrite(accepted('nuwa:p1') as never, { 'nuwa:p1': { verdict: 'rejected' as const } })
    expect(plan.toWrite).toEqual([])
    expect(plan.protectedIds).toEqual(['nuwa:p1'])
  })

  it('还没判过的（pending）照常写，正对着上面两条', () => {
    const plan = mergeStatementsForWrite(accepted('nuwa:p1') as never, { 'nuwa:p1': { verdict: 'pending' as const } })
    expect(plan.toWrite).toHaveLength(1)
    expect(plan.protectedIds).toEqual([])
  })

  it('库里没有的新结论写进去', () => {
    const plan = mergeStatementsForWrite(accepted('nuwa:p9') as never, {})
    expect(plan.toWrite).toHaveLength(1)
  })
})

describe('界面那一句：丢了什么必须说出来', () => {
  it('一条都没有 ⇒ 不是「导入成功 0 条」', () => {
    const text = describeStatementImport({ toWrite: [], protectedIds: [], rejected: [] })
    expect(text).toContain('没有一条能用')
    expect(text).not.toMatch(/成功.*0/)
  })

  it('写进去 N 条时把丢弃数与原因逐条带上', () => {
    const text = describeStatementImport({
      toWrite: [{}, {}] as never,
      protectedIds: ['nuwa:p3'],
      rejected: [
        { id: 'p4', reason: 'too_few_evidence' },
        { id: 'p5', reason: 'unknown_evidence' },
      ],
    })
    expect(text).toContain('收下 2 条')
    expect(text).toContain('3 条没动或没收')
    expect(text).toContain('证据不足两条')
    expect(text).toContain('对不上你的语料')
    expect(text).toContain('你已经判过的 1 条保持原样')
  })

  it('每种丢弃原因都有人话，不许出现英文键名', () => {
    const reasons: RejectReason[] = [
      'too_few_evidence',
      'unknown_evidence',
      'inferred_disabled',
      'bad_layer',
      'blank_statement',
      'blank_topic',
      'blank_id',
      'not_an_object',
      'duplicate_id',
    ]
    for (const reason of reasons) {
      const text = describeStatementImport({ toWrite: [{ id: 'x' }] as never, protectedIds: [], rejected: [{ id: 'x', reason }] })
      expect(text).not.toContain(reason)
      expect(text).not.toContain('undefined')
      expect(text.length).toBeGreaterThan('没有一条能用'.length)
    }
  })
})
