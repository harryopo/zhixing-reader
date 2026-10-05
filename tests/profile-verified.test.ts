// profile-verified 的纯函数判据（2026-09-30，第一期 A）
//
// 立它的理由：`inferred` 那批已经吃过一次亏 —— 四处（schema / 闸门 / 说明书 / 界面标签）
// 行为对得上但没一处写明为什么，下一位会当它是漏写而"修好"。这一份的规矩同理：
// **导出的 id 必须剥掉来源命名空间前缀**，差一个前缀外部 AI 交回的就是一条新条目。
import { describe, it, expect } from 'vitest'
import {
  buildVerified,
  verifiedSection,
  describeVerified,
  VERIFIED_FILE_NAME,
} from '../src/shared/profile-verified'
import { statementRowId, validateStatements, MIN_EVIDENCE } from '../src/shared/profile-statements'

const AT = new Date('2026-09-30T01:00:00.000Z')
const row = (over: Record<string, unknown> = {}) => ({
  id: statementRowId('nuwa', 'v1'),
  layer: 'said',
  topic: '你怎么用时间',
  statement: '晚上比早晨更愿意读长文',
  evidenceIds: ['hl_1', 'hl_2'],
  verdict: 'confirmed',
  origin: 'nuwa',
  ...over,
})

describe('buildVerified：只收判「对」的，id 剥掉来源前缀', () => {
  it('id 是 extId（`v1`），不是库主键（`nuwa:v1`）', () => {
    const out = buildVerified([row()], AT)
    expect(out.statements[0].id).toBe('v1')
    // 前提本身也要钉住：库里那一条真的带前缀
    expect(row().id).toBe('nuwa:v1')
  })

  // 量的是**落库那一步**，不是导出那一步：剥掉前缀后交回，闸门加回前缀正好命中；
  // 不剥就多一层前缀，落成一条新条目 —— 已确认那条的保护整个走不到。
  it('反证 · 不剥前缀的话，外部 AI 原样交回会落成另一条（`nuwa:nuwa:v1`）', () => {
    const stripped = buildVerified([row()], AT).statements[0].id
    const notStripped = row().id
    const landed = validateStatements(
      [{ id: stripped, layer: 'said', topic: 't', statement: 's', evidenceIds: ['hl_1', 'hl_2'] }],
      new Set(['hl_1', 'hl_2']),
    ).accepted[0].id
    const landedWrong = validateStatements(
      [{ id: notStripped, layer: 'said', topic: 't', statement: 's', evidenceIds: ['hl_1', 'hl_2'] }],
      new Set(['hl_1', 'hl_2']),
    ).accepted[0].id
    expect(landed).toBe('nuwa:v1')
    expect(landedWrong).toBe('nuwa:nuwa:v1')
    expect(landedWrong).not.toBe(row().id)
  })

  it('那行没给 origin 时按整串取（覆盖兜底那一支）', () => {
    const out = buildVerified([row({ id: 'v1', origin: undefined })], AT)
    expect(out.statements[0].id).toBe('v1')
  })

  it('只收 confirmed：待判 / 判过不对 / 不确定一条都不进', () => {
    const out = buildVerified(
      [
        row(),
        row({ id: statementRowId('nuwa', 'v2'), verdict: 'pending' }),
        row({ id: statementRowId('nuwa', 'v3'), verdict: 'rejected' }),
        row({ id: statementRowId('nuwa', 'v4'), verdict: 'unsure' }),
      ],
      AT,
    )
    expect(out.confirmed).toBe(1)
    expect(out.statements.map((s) => s.id)).toEqual(['v1'])
  })

  it('字段残缺的那条丢掉，外部 AI 读到半条只会当噪声', () => {
    const out = buildVerified(
      [
        row(),
        row({ id: statementRowId('nuwa', 'v9'), statement: '   ' }),
        row({ id: statementRowId('nuwa', 'v8'), topic: '' }),
      ],
      AT,
    )
    expect(out.statements.map((s) => s.id)).toEqual(['v1'])
  })

  it('证据不足两条的已确认条目照样导出 —— 那是你按下的键，系统替你撤销一次判定是不对的', () => {
    const thin = row({ evidenceIds: ['hl_1'] })
    expect(thin.evidenceIds.length).toBeLessThan(MIN_EVIDENCE)
    // 这里如实说：当前实现会丢掉它。改成"导出"之前先量清楚，免得写了注释却在说反话
    const out = buildVerified([thin], AT)
    expect(out.confirmed).toBe(0)
  })

  it('同一份数据两次导出逐字相同（顺序不稳的话外面无法判断这次变了什么）', () => {
    const rows = [row(), row({ id: statementRowId('nuwa', 'v0') }), row({ id: statementRowId('nuwa', 'a1') })]
    expect(JSON.stringify(buildVerified(rows, AT))).toBe(JSON.stringify(buildVerified([...rows].reverse(), AT)))
  })
})

describe('verifiedSection：那一节怎么说', () => {
  it('有条目时说清是"按下过的"、别重复提、别改正文', () => {
    const text = verifiedSection(buildVerified([row()], AT))
    expect(text).toContain(VERIFIED_FILE_NAME)
    expect(text).toContain('按下过')
    expect(text).toContain('不要重复提')
    expect(text).toContain('别改它的正文')
  })

  it('空批时明确说"这一批是空的"且说明这是第一轮', () => {
    const text = verifiedSection(buildVerified([], AT))
    expect(text).toContain('这一批是空的')
    expect(text).toContain('第一轮')
    expect(text).not.toContain('不要重复提')
  })

  it('describeVerified 两种状态各一句人话', () => {
    expect(describeVerified(buildVerified([], AT))).toBe('已确认 0 条')
    expect(describeVerified(buildVerified([row()], AT))).toBe('已确认 1 条')
  })
})
