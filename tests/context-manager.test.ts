// 知行读书 — context-manager 单元测试（2026-07-24，过夜 Task #8）
//
// 覆盖 ContextManager 的注册排序、预算控制、截断、错误隔离、空跳过逻辑。
// context-manager 是 agent 上下文构建的协调核心，0 单测。
// 用 stub builder 验证调度行为，不依赖真实 DB / builders。

import { describe, it, expect, beforeEach } from 'vitest'
import { ContextManager } from '../electron/agent/context-manager'
import type { ContextBuilder, ContextBuildResult, BuildContext } from '../electron/agent/context-builder'

/** 构造 stub builder */
function makeBuilder(
  name: string,
  priority: number,
  content: string,
  shouldBuildFn: (ctx: BuildContext) => boolean = () => true,
): ContextBuilder {
  return {
    name,
    priority,
    shouldBuild: shouldBuildFn,
    build: async (): Promise<ContextBuildResult> => ({
      content,
      priority,
      metadata: { source: 'stub', buildTime: 1 },
    }),
  }
}

const baseCtx: BuildContext = {
  sessionId: 's1',
  userMessage: 'test',
  conversationHistory: [],
}

describe('context-manager — 注册与排序', () => {
  let cm: ContextManager

  beforeEach(() => {
    cm = new ContextManager()
  })

  it('无 builder 时 buildAll 返回空上下文', async () => {
    const { combinedContext, results } = await cm.buildAll(baseCtx)
    expect(combinedContext).toBe('')
    expect(results).toHaveLength(0)
  })

  it('单个 builder 正常构建', async () => {
    cm.registerBuilder(makeBuilder('book', 100, '书籍内容'))
    const { combinedContext, results } = await cm.buildAll(baseCtx)
    expect(combinedContext).toBe('书籍内容')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('book')
  })

  it('按优先级降序执行（高优先级在前）', async () => {
    const order: string[] = []
    cm.registerBuilder({
      name: 'low',
      priority: 10,
      shouldBuild: () => true,
      build: async () => {
        order.push('low')
        return { content: 'L', priority: 10 }
      },
    })
    cm.registerBuilder({
      name: 'high',
      priority: 100,
      shouldBuild: () => true,
      build: async () => {
        order.push('high')
        return { content: 'H', priority: 100 }
      },
    })
    cm.registerBuilder({
      name: 'mid',
      priority: 50,
      shouldBuild: () => true,
      build: async () => {
        order.push('mid')
        return { content: 'M', priority: 50 }
      },
    })

    await cm.buildAll(baseCtx)
    expect(order).toEqual(['high', 'mid', 'low'])
  })

  it('shouldBuild 返回 false 时跳过该 builder', async () => {
    cm.registerBuilder(makeBuilder('skipped', 100, '不应出现', () => false))
    cm.registerBuilder(makeBuilder('kept', 50, '保留', () => true))
    const { combinedContext, results } = await cm.buildAll(baseCtx)
    expect(combinedContext).toBe('保留')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('kept')
  })
})

describe('context-manager — 预算控制与截断', () => {
  let cm: ContextManager

  beforeEach(() => {
    cm = new ContextManager()
  })

  it('总预算 4000 tokens，未超限时全部纳入', async () => {
    // 每个字符约 0.5 token（CHARS_PER_TOKEN=2），4000 tokens = 8000 字符
    cm.registerBuilder(makeBuilder('a', 100, '短内容'))
    cm.registerBuilder(makeBuilder('b', 50, '短内容2'))
    const { results } = await cm.buildAll(baseCtx)
    expect(results).toHaveLength(2)
  })

  it('超出预算时截断最后一个 builder 并停止后续', async () => {
    // 构造一个超大 builder 把预算占满
    const bigContent = 'X'.repeat(9000) // 9000 字符 ≈ 4500 tokens，超 4000
    cm.registerBuilder(makeBuilder('big', 100, bigContent))
    cm.registerBuilder(makeBuilder('after', 50, '不应出现'))

    const { results } = await cm.buildAll(baseCtx)
    // big 被截断，after 因 truncated=true 被跳过
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('big')
    expect(results[0].result.content).toContain('已截断')
  })

  it('截断后内容长度不超过剩余预算', async () => {
    // 先放一个小 builder 占用部分预算
    cm.registerBuilder(makeBuilder('small', 200, '小'.repeat(100)))
    // 再放大 builder 触发截断
    cm.registerBuilder(makeBuilder('big', 100, 'Y'.repeat(10000)))
    const { results } = await cm.buildAll(baseCtx)
    const big = results.find((r) => r.name === 'big')
    expect(big).toBeDefined()
    expect(big!.result.content).toContain('已截断')
    // 截断后长度应远小于原始 10000
    expect(big!.result.content.length).toBeLessThan(10000)
  })
})

describe('context-manager — 错误隔离', () => {
  let cm: ContextManager

  beforeEach(() => {
    cm = new ContextManager()
  })

  it('单个 builder 抛错不影响其他 builder', async () => {
    cm.registerBuilder({
      name: 'bad',
      priority: 100,
      shouldBuild: () => true,
      build: async () => {
        throw new Error('builder boom')
      },
    })
    cm.registerBuilder(makeBuilder('good', 50, '正常内容'))

    const { combinedContext, results } = await cm.buildAll(baseCtx)
    // bad 出错但被捕获，good 正常执行
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.name === 'bad')?.result.content).toBe('')
    expect(results.find((r) => r.name === 'bad')?.result.metadata?.error).toBe('builder boom')
    expect(combinedContext).toBe('正常内容')
  })

  it('builder 抛非 Error 对象时记录字符串', async () => {
    cm.registerBuilder({
      name: 'bad',
      priority: 100,
      shouldBuild: () => true,
      build: async () => {
        throw 'string error'
      },
    })
    const { results } = await cm.buildAll(baseCtx)
    expect(results[0].result.metadata?.error).toBe('string error')
  })

  it('空 content 的 builder 不计入 combinedContext', async () => {
    cm.registerBuilder(makeBuilder('empty', 100, ''))
    cm.registerBuilder(makeBuilder('has', 50, '有内容'))
    const { combinedContext } = await cm.buildAll(baseCtx)
    expect(combinedContext).toBe('有内容')
  })
})

describe('context-manager — getBuilderStats', () => {
  it('返回空对象（当前为 TODO 占位）', () => {
    const cm = new ContextManager()
    cm.registerBuilder(makeBuilder('a', 100, 'x'))
    expect(cm.getBuilderStats()).toEqual({})
  })
})
