// 知行读书 — ai-service JSON 修复/提取纯函数单测（2026-07-24，过夜 Task #5）
//
// 覆盖 extractAndParseJSON / repairJSON 的边界，不依赖 LLM / 网络。
// 这两个函数是 distillKnowledgeCards / generateCards 等结构化输出的兜底核心，
// 之前无单测（只在集成测试里被间接调用），本轮补齐。

import { describe, it, expect } from 'vitest'
import * as aiService from '../electron/ai-service'
import { extractAndParseJSON, repairJSON } from '../electron/ai-service'

const { getJsonRepairStats } = aiService

type JsonRepairStats = ReturnType<typeof getJsonRepairStats>

/** 两次快照的差值 —— 让断言不受同文件其他用例已产生的计数影响 */
function delta(after: JsonRepairStats, before: JsonRepairStats): JsonRepairStats {
  return {
    parseFailed: after.parseFailed - before.parseFailed,
    repaired: after.repaired - before.repaired,
    salvaged: after.salvaged - before.salvaged,
    failed: after.failed - before.failed,
  }
}

describe('ai-service — extractAndParseJSON', () => {
  describe('数组提取', () => {
    it('纯 JSON 数组直接解析', () => {
      const result = extractAndParseJSON<Array<{ a: number }>>(
        '[{"a":1},{"a":2}]',
        true,
      )
      expect(result).toEqual([{ a: 1 }, { a: 2 }])
    })

    it('从 markdown 代码块中提取数组', () => {
      const content = '```json\n[{"front":"Q","back":"A"}]\n```'
      const result = extractAndParseJSON<Array<{ front: string; back: string }>>(
        content,
        true,
      )
      expect(result).toEqual([{ front: 'Q', back: 'A' }])
    })

    it('从含前后解释文字中提取数组', () => {
      const content = '好的，以下是卡片：\n[{"front":"Q","back":"A"}]\n希望对你有帮助。'
      const result = extractAndParseJSON<Array<{ front: string; back: string }>>(
        content,
        true,
      )
      expect(result).toHaveLength(1)
      expect(result[0].front).toBe('Q')
    })

    it('无有效数组时抛错', () => {
      expect(() => extractAndParseJSON<unknown[]>('纯文本无JSON', true)).toThrow(
        /未找到有效的JSON/,
      )
    })

    it('修复尾随逗号后解析成功', () => {
      // repairJSON 应能处理 [{...},] 的尾随逗号
      const result = extractAndParseJSON<Array<{ front: string; back: string }>>(
        '[{"front":"Q","back":"A",},]',
        true,
      )
      expect(result).toEqual([{ front: 'Q', back: 'A' }])
    })
  })

  describe('对象提取', () => {
    it('纯 JSON 对象直接解析', () => {
      const result = extractAndParseJSON<{ summary: string; keyPoints: string[] }>(
        '{"summary":"好书","keyPoints":["a","b"]}',
        false,
      )
      expect(result.summary).toBe('好书')
      expect(result.keyPoints).toEqual(['a', 'b'])
    })

    it('从 markdown 代码块中提取对象', () => {
      const content = '```json\n{"summary":"S"}\n```'
      const result = extractAndParseJSON<{ summary: string }>(content, false)
      expect(result.summary).toBe('S')
    })

    it('无有效对象时抛错', () => {
      expect(() => extractAndParseJSON<unknown>('无JSON文本', false)).toThrow(
        /未找到有效的JSON/,
      )
    })
  })
})

describe('ai-service — repairJSON', () => {
  it('已是合法 JSON 时原样返回（等价）', () => {
    const valid = '{"a":1}'
    // repairJSON 对合法 JSON 不破坏语义
    expect(JSON.parse(repairJSON(valid))).toEqual({ a: 1 })
  })

  it('修复中文引号为英文引号', () => {
    // 全角引号 “ ” → 半角；repairJSON 只做字符替换，不改变字符串内容
    // 验证：转换后是合法 JSON
    const repaired = repairJSON('{"name":"test"}')
    expect(JSON.parse(repaired).name).toBe('test')
    // 全角引号在 key/value 边界会被替换，内部不影响
    const repaired2 = repairJSON('{“a”:“b”}')
    expect(JSON.parse(repaired2).a).toBe('b')
  })

  it('修复尾随逗号（数组）', () => {
    const repaired = repairJSON('[1,2,3,]')
    expect(JSON.parse(repaired)).toEqual([1, 2, 3])
  })

  it('修复尾随逗号（对象）', () => {
    const repaired = repairJSON('{"a":1,"b":2,}')
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: 2 })
  })

  it('补全缺失的右括号（仅缺失 ]）', () => {
    // repairJSON 按括号计数补全，只测它能补的：缺右方括号
    const repaired = repairJSON('[{"a":1},{"b":2}]') // 完整的不破坏
    expect(JSON.parse(repaired)).toEqual([{ a: 1 }, { b: 2 }])

    // 缺一个 ]：计数补全
    const repaired2 = repairJSON('[1,2,3')
    // repairJSON 会补 ]，得到 [1,2,3]
    expect(() => JSON.parse(repaired2)).not.toThrow()
  })

  it('字符串内的换行转义为 \\n', () => {
    // 模型有时在字符串里输出裸换行，repairJSON 应转义
    const repaired = repairJSON('{"text":"line1\nline2"}')
    expect(JSON.parse(repaired).text).toBe('line1\nline2')
  })

  // ── 以下三条是 2026-09 实测线上故障后的回归测试 ──

  it('字符串内的中文引号不能被改坏（曾把合法 JSON 修成非法）', () => {
    // 故障现场：模型返回的 name 值里含中文引号，形如 活在“此时此刻”。
    // 旧实现先做无差别全角引号替换，把它变成了 活在"此时此刻"，
    // 于是一份**本来就合法**的 JSON 被「修复」成非法，报 position 22。
    const raw = '[\n  {\n    "name": "活在“此时此刻”",\n    "note": "人生是连续的刹那"\n  }\n]'
    const parsed = JSON.parse(repairJSON(raw)) as Array<{ name: string; note: string }>
    expect(parsed[0].name).toBe('活在“此时此刻”')
    expect(parsed[0].note).toBe('人生是连续的刹那')
  })

  it('补全缺失的逗号（LLM 最常见 JSON 错误）', () => {
    // 报错形态：Expected ',' or '}' after property value
    const raw = '[\n  {\n    "name": "课题分离"\n    "description": "把自己的课题与别人的课题分开"\n  }\n]'
    const parsed = JSON.parse(repairJSON(raw)) as Array<{ name: string; description: string }>
    expect(parsed[0].name).toBe('课题分离')
    expect(parsed[0].description).toBe('把自己的课题与别人的课题分开')
  })

  it('缺失逗号与字符串内中文标点可同时修复，且不改动正文', () => {
    const raw = '{\n  "a": "第一，第二"\n  "b": "第三：第四"\n}'
    const parsed = JSON.parse(repairJSON(raw)) as { a: string; b: string }
    // 中文逗号/冒号在字符串内必须原样保留，不能被归一成半角
    expect(parsed.a).toBe('第一，第二')
    expect(parsed.b).toBe('第三：第四')
  })

  it('已含逗号时不会重复插入逗号', () => {
    const raw = '[\n  {\n    "a": "x",\n    "b": "y"\n  }\n]'
    const parsed = JSON.parse(repairJSON(raw)) as Array<{ a: string; b: string }>
    expect(parsed[0]).toEqual({ a: 'x', b: 'y' })
  })

  it('数组被 max_tokens 截断时，抢救出已完整输出的对象', () => {
    // 故障现场：27 个方法论的 JSON 在最后一个对象的 "steps": [ 处戛然而止，
    // 整体解析必然失败。丢掉整批太浪费 —— 前面已完整的对象应当可用。
    const truncated = [
      '[',
      '  {"name":"A","tags":["x"]},',
      '  {"name":"B","tags":["y"]},',
      '  {"name":"C","steps":[',
      '    "只有半截',
    ].join('\n')

    const result = extractAndParseJSON<Array<{ name: string }>>(truncated, true)
    expect(result.map((r) => r.name)).toEqual(['A', 'B'])
  })

  it('截断且一个完整对象都没有时，仍抛错（不能假装成功）', () => {
    const truncated = '[\n  {"name":"A","steps":[\n    "半截'
    expect(() => extractAndParseJSON<unknown[]>(truncated, true)).toThrow(/JSON解析失败/)
  })
})

// B1 取证：老通路的 repairJSON / salvageArrayItems 到底多久命中一次，
// 决定剩下两个 JSON 数组型功能是「硬迁 zod 严格 schema」还是「必须留容错层」。
// 断言一律用**增量**（不要求测试间重置计数器 —— 那需要一个只有测试会调的生产方法）。
describe('ai-service — JSON 抢救命中计数', () => {
  const cleanArray = '[{"name":"A"},{"name":"B"}]'
  const trailingComma = '[{"front":"Q","back":"A",},]'
  const truncatedArray = [
    '[',
    '  {"name":"A","tags":["x"]},',
    '  {"name":"C","steps":[',
    '    "只有半截',
  ].join('\n')
  const hopeless = '[\n  {"name":"A","steps":[\n    "半截'

  it('干净 JSON 一次都不计入（这是"可以直接硬迁"的判据）', () => {
    const before = getJsonRepairStats()
    extractAndParseJSON(cleanArray, true)
    expect(delta(getJsonRepairStats(), before)).toEqual({
      parseFailed: 0,
      repaired: 0,
      salvaged: 0,
      failed: 0,
    })
  })

  it('repairJSON 修好时 parseFailed 与 repaired 各 +1', () => {
    const before = getJsonRepairStats()
    expect(extractAndParseJSON(trailingComma, true)).toEqual([{ front: 'Q', back: 'A' }])
    expect(delta(getJsonRepairStats(), before)).toEqual({
      parseFailed: 1,
      repaired: 1,
      salvaged: 0,
      failed: 0,
    })
  })

  it('数组被截断走抢救时 salvaged +1，且不算 repaired', () => {
    const before = getJsonRepairStats()
    expect(extractAndParseJSON<Array<{ name: string }>>(truncatedArray, true).map((r) => r.name)).toEqual(['A'])
    expect(delta(getJsonRepairStats(), before)).toEqual({
      parseFailed: 1,
      repaired: 0,
      salvaged: 1,
      failed: 0,
    })
  })

  it('彻底失败时 failed +1 并抛错', () => {
    const before = getJsonRepairStats()
    expect(() => extractAndParseJSON(hopeless, true)).toThrow(/JSON解析失败/)
    expect(delta(getJsonRepairStats(), before)).toEqual({
      parseFailed: 1,
      repaired: 0,
      salvaged: 0,
      failed: 1,
    })
  })
})
