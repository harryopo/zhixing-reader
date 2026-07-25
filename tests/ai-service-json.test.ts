// 知行读书 — ai-service JSON 修复/提取纯函数单测（2026-07-24，过夜 Task #5）
//
// 覆盖 extractAndParseJSON / repairJSON 的边界，不依赖 LLM / 网络。
// 这两个函数是 distillKnowledgeCards / generateCards 等结构化输出的兜底核心，
// 之前无单测（只在集成测试里被间接调用），本轮补齐。

import { describe, it, expect } from 'vitest'
import { extractAndParseJSON, repairJSON } from '../electron/ai-service'

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
      const result = extractAndParseJSON<{ summary: string }>(
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
})
