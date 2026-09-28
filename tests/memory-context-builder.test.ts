// 记忆上下文构建器（2026-09-28）
//
// 起点是覆盖率清单那条 **79.24 / 77.77 / 100**：`shouldBuild` 走过、`build` 的三种交回形状
// 与 catch 没走过。这一层决定的是「AI 回答时看不看得到你过去记下的东西」，
// 坏起来不报错，只是提示词里静悄悄少了整块记忆。
//
// mock 只打在**这一层唯一的下游**（`memory-service`）与 logger 上：
// 服务自己读库、排序、转义的口径由 `tests/memory-relevance-real-db.test.ts`（真库）与
// `tests/memory-service.test.ts` 负责，这里不重复抄一遍，也因此能把「服务交回什么形状」
// 逐条喂准 —— 包括真实通路里很难造的失败。
//
// 有一处要说清：服务层三个函数自己包着 try/catch（读库失败回 `[]` / `''` / `false`），
// 所以本文件里那条"抛错"的判据**是喂给 catch 的形状，不是量出来的缺陷**。
// 它钉的是"出错时交回什么"（空 content + `metadata.error`，界面那块显示「未取到」而不是崩），
// 不是"这里会出事"。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BuildContext } from '../electron/agent/context-builder'
import type { Memory } from '../electron/services/memory-service'

const { seams, logger } = vi.hoisted(() => ({
  seams: {
    getRelevantMemories: vi.fn<(query: string, limit: number) => Memory[]>(() => []),
    generateMemorySummary: vi.fn<() => string>(() => ''),
    hasMemories: vi.fn<() => boolean>(() => false),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../electron/services/memory-service', () => seams)
vi.mock('../electron/logger', () => ({ logger }))

import { MemoryContextBuilder } from '../electron/agent/builders/memory-context-builder'

const ctx: BuildContext = {
  sessionId: 's1',
  userMessage: '习惯为什么难改',
  conversationHistory: [],
}

function memory(id: string, content: string): Memory {
  return {
    id,
    type: 'preference',
    category: 'reading',
    content,
    importance: 0.5,
    createdAt: '2026-09-28 01:02:03',
    lastAccessedAt: '2026-09-28 01:02:03',
    accessCount: 0,
  }
}

let builder: MemoryContextBuilder

beforeEach(() => {
  vi.clearAllMocks()
  seams.getRelevantMemories.mockReturnValue([])
  seams.generateMemorySummary.mockReturnValue('')
  seams.hasMemories.mockReturnValue(false)
  builder = new MemoryContextBuilder()
})

describe('门槛与身份', () => {
  it('name 是 memory、priority 是 50（上下文预算按这个数排队）', () => {
    expect(builder.name).toBe('memory')
    expect(builder.priority).toBe(50)
  })

  it('shouldBuild 只问「有没有记忆」，不预支检索与摘要的开销', () => {
    seams.hasMemories.mockReturnValue(true)
    expect(builder.shouldBuild(ctx)).toBe(true)
    expect(seams.hasMemories).toHaveBeenCalledTimes(1)
    expect(seams.getRelevantMemories, '开门阶段不该去翻库').not.toHaveBeenCalled()
    expect(seams.generateMemorySummary, '开门阶段不该去算摘要').not.toHaveBeenCalled()
  })

  it('没有记忆时 shouldBuild 回 false（对话链路据此整块跳过，而不是拼个空标题）', () => {
    seams.hasMemories.mockReturnValue(false)
    expect(builder.shouldBuild(ctx)).toBe(false)
  })
})

describe('build 的取数口径', () => {
  it('拿用户这句话去检索，条数上限是 3', () => {
    builder.build(ctx)
    expect(seams.getRelevantMemories).toHaveBeenCalledWith('习惯为什么难改', 3)
  })

  it('摘要与相关记忆各取一次，不多翻库', () => {
    builder.build(ctx)
    expect(seams.generateMemorySummary).toHaveBeenCalledTimes(1)
    expect(seams.getRelevantMemories).toHaveBeenCalledTimes(1)
  })
})

describe('三种交回形状', () => {
  it('两侧都空 ⇒ content 是空串，而不是一个光杆标题', () => {
    const result = builder.build(ctx)
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
    expect(result.metadata?.method).toBe('keyword')
    expect(result.metadata?.source).toBe('memory-service')
    expect(logger.info, '什么都没取到不该记一条"已加载"').not.toHaveBeenCalled()
  })

  it('只有摘要 ⇒ 摆摘要，不摆「相关记忆」那一段', () => {
    seams.generateMemorySummary.mockReturnValue('用户偏好：喜欢短篇')
    const result = builder.build(ctx)
    expect(result.content).toContain('用户偏好：喜欢短篇')
    expect(result.content).not.toContain('相关记忆')
    expect(result.metadata?.itemCount).toBe(0)
  })

  it('只有相关记忆 ⇒ 每条一行、顺序按服务交回的来', () => {
    seams.getRelevantMemories.mockReturnValue([memory('m1', '第一条'), memory('m2', '第二条')])
    const result = builder.build(ctx)
    expect(result.content).toContain('相关记忆：\n- 第一条\n- 第二条')
    expect(result.content).not.toContain('用户偏好')
    expect(result.metadata?.itemCount).toBe(2)
  })

  it('两侧都有 ⇒ 摘要在前、相关记忆在后，itemCount 只数真交回的条数', () => {
    seams.generateMemorySummary.mockReturnValue('学习洞察：先诊断后编码')
    seams.getRelevantMemories.mockReturnValue([memory('m1', '一条'), memory('m2', '两条'), memory('m3', '三条')])
    const result = builder.build(ctx)
    expect(result.content.indexOf('学习洞察')).toBeLessThan(result.content.indexOf('相关记忆'))
    expect(result.metadata?.itemCount).toBe(3)
  })

  it('交回的文案两头是「## 记忆上下文」与那句用途说明（提示词里这块靠它们认）', () => {
    seams.getRelevantMemories.mockReturnValue([memory('m1', '一条')])
    const result = builder.build(ctx)
    expect(result.content).toContain('## 记忆上下文')
    expect(result.content.trimEnd().endsWith('基于用户的记忆和历史偏好来个性化回答。')).toBe(true)
  })
})

describe('交回给「调取知识库」面板的预览', () => {
  it('超过 60 字的正文截到 60 字并补省略号', () => {
    const long = '长'.repeat(61)
    seams.getRelevantMemories.mockReturnValue([memory('m1', long)])
    expect(builder.build(ctx).metadata?.previews).toEqual([{ snippet: `${'长'.repeat(60)}…` }])
  })

  it('恰好 60 字不截、不加省略号（两头各钉一条）', () => {
    const exact = '长'.repeat(60)
    seams.getRelevantMemories.mockReturnValue([memory('m1', exact)])
    expect(builder.build(ctx).metadata?.previews).toEqual([{ snippet: exact }])
  })

  it('预览与 itemCount 是同一批：列了几条就预览几条，顺序也一样', () => {
    // 检索上限就是 3，所以"服务交回 5 条"是造不出来的形状 —— 这里对账的是真能发生的形状：
    // itemCount 说的条数、正文里列的条数、预览里的条数必须是同一个数
    seams.getRelevantMemories.mockReturnValue([memory('m1', '第一条'), memory('m2', '第二条'), memory('m3', '第三条')])
    const result = builder.build(ctx)
    expect(result.metadata?.itemCount).toBe(3)
    expect(result.metadata?.previews).toEqual([{ snippet: '第一条' }, { snippet: '第二条' }, { snippet: '第三条' }])
  })

  it('只有摘要时预览是空数组，而不是 undefined 或 null', () => {
    seams.generateMemorySummary.mockReturnValue('用户偏好：喜欢短篇')
    expect(builder.build(ctx).metadata?.previews).toEqual([])
  })
})

describe('出错时交回什么（喂给 catch 的形状，不是量出来的缺陷）', () => {
  it('检索抛 Error ⇒ 空 content + metadata.error 记原文，且不去记"已加载"', () => {
    seams.getRelevantMemories.mockImplementation(() => {
      throw new Error('库被锁住了')
    })
    const result = builder.build(ctx)
    expect(result.content).toBe('')
    expect(result.metadata?.error).toBe('库被锁住了')
    expect(result.priority).toBe(50)
    expect(logger.error).toHaveBeenCalledWith('Failed to build memory context', expect.any(Error))
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('摘要那侧抛错也一样：整块让位，不交出半个记忆上下文', () => {
    seams.getRelevantMemories.mockReturnValue([memory('m1', '一条')])
    seams.generateMemorySummary.mockImplementation(() => {
      throw new Error('摘要算不出来')
    })
    const result = builder.build(ctx)
    expect(result.content).toBe('')
    expect(result.metadata?.error).toBe('摘要算不出来')
  })

  it('抛的不是 Error 时也要有话可说（String 兜底，不许 undefined 进 metadata）', () => {
    seams.getRelevantMemories.mockImplementation(() => {
      throw '字符串形式的失败'
    })
    expect(builder.build(ctx).metadata?.error).toBe('字符串形式的失败')
  })
})
