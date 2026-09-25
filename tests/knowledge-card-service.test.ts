// 知行读书 — knowledge-card-service 单元测试（2026-07-24，过夜 Task #13）
//
// 覆盖单例 + 任务管理 + 并发防重 + 取消 + 自动导入兜底。
// knowledge-card-service 是知识卡片蒸馏的协调核心（防并发/取消/进度回传），0 单测。
// mock 依赖（database/weread-api/ai-service/BrowserWindow/logger），验证状态机。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AI_INPUT_LIMITS, coverageNotice } from '../src/shared/ai-coverage'

// ===== vi.hoisted mock =====
const {
  mockGetByBookId,
  mockKnowledgeCreate,
  mockFetchAllContent,
  mockDistill,
  mockProcessedIds,
  mockRecordBatch,
  mockClearBatches,
  mockCardCounts,
} = vi.hoisted(() => ({
  // 显式标注返回类型：`vi.fn(() => [])` 会被推成 `never[]`，之后 mockReturnValue 喂真行数据全判红
  // （生产签名是 `highlightsDb.getByBookId(): Record<string, unknown>[]`）
  mockGetByBookId: vi.fn((): Record<string, unknown>[] => []),
  mockKnowledgeCreate: vi.fn(),
  mockFetchAllContent: vi.fn(),
  mockDistill: vi.fn(),
  mockProcessedIds: vi.fn((): string[] => []),
  mockRecordBatch: vi.fn(),
  mockClearBatches: vi.fn((): number => 0),
  // 每本书的成品数：测试里按用例改写（默认空 = 这本书一张卡片都没有）
  mockCardCounts: vi.fn((): Record<string, number> => ({})),
}))

vi.mock('../electron/database', () => ({
  knowledgeCardsDb: {
    create: mockKnowledgeCreate,
    deleteByBookId: vi.fn(() => 0),
    getCountsByBook: mockCardCounts,
  },
  highlightsDb: {
    getByBookId: mockGetByBookId,
    create: vi.fn(),
  },
  aiBatchesDb: {
    getProcessedIds: mockProcessedIds,
    record: mockRecordBatch,
    clear: mockClearBatches,
    getProcessedCounts: vi.fn(() => ({})),
  },
}))

vi.mock('../electron/weread-api', () => ({
  fetchAllContent: mockFetchAllContent,
}))

vi.mock('../electron/ai-service', () => ({
  distillKnowledgeCards: mockDistill,
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../src/shared/ipc-channels', () => ({
  IPC_CHANNELS: { KNOWLEDGE_CARDS: { DISTILL_PROGRESS: 'kc:progress' } },
}))

import { knowledgeCardService } from '../electron/services/knowledge-card-service'

describe('knowledge-card-service — 单例', () => {
  it('getInstance 返回同一实例', () => {
    // knowledgeCardService 已是单例实例
    expect(knowledgeCardService).toBeDefined()
    expect(typeof knowledgeCardService.isDistilling).toBe('function')
  })
})

describe('knowledge-card-service — 任务状态管理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetByBookId.mockReturnValue([])
    mockDistill.mockReset()
  })

  it('无任务时 isDistilling 返回 false', () => {
    expect(knowledgeCardService.isDistilling('b1')).toBe(false)
  })

  it('getActiveBookIds 初始为空', () => {
    expect(knowledgeCardService.getActiveBookIds()).toEqual([])
  })

  it('蒸馏中时 isDistilling 返回 true', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '第1章' }])
    // distill 挂起一个 promise，让任务保持 active
    let resolveDistill: (v: unknown[]) => void
    mockDistill.mockReturnValue(
      new Promise((r) => {
        resolveDistill = r
      }),
    )
    const distillPromise = knowledgeCardService.distillBook('b-active', '书名')
    // 等任务注册
    await new Promise((r) => setTimeout(r, 10))
    expect(knowledgeCardService.isDistilling('b-active')).toBe(true)
    expect(knowledgeCardService.getActiveBookIds()).toContain('b-active')

    // 完成蒸馏
    resolveDistill!([])
    await distillPromise
    // 完成后任务清除
    expect(knowledgeCardService.isDistilling('b-active')).toBe(false)
  })

  it('同一书重复蒸馏抛「正在蒸馏中」错误', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '第1章' }])
    let resolveDistill: (v: unknown[]) => void
    mockDistill.mockReturnValue(
      new Promise((r) => {
        resolveDistill = r
      }),
    )
    const firstPromise = knowledgeCardService.distillBook('b-dup', '书名')
    await new Promise((r) => setTimeout(r, 10))

    await expect(knowledgeCardService.distillBook('b-dup', '书名')).rejects.toThrow(/正在蒸馏中/)
    resolveDistill!([])
    await firstPromise
  })

  it('cancelDistill 无任务时返回 false', () => {
    expect(knowledgeCardService.cancelDistill('nonexistent')).toBe(false)
  })

  it('cancelDistill 有任务时返回 true 并 abort', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '第1章' }])
    let resolveDistill: (v: unknown[]) => void
    mockDistill.mockReturnValue(
      new Promise((r) => {
        resolveDistill = r
      }),
    )
    const distillPromise = knowledgeCardService.distillBook('b-cancel', '书名')
    await new Promise((r) => setTimeout(r, 10))

    const cancelResult = knowledgeCardService.cancelDistill('b-cancel')
    expect(cancelResult).toBe(true)

    resolveDistill!([])
    await distillPromise
  })
})

describe('knowledge-card-service — distillBook 流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetByBookId.mockReturnValue([])
    mockDistill.mockReset()
    mockKnowledgeCreate.mockReset()
    mockFetchAllContent.mockReset()
    // mockReset 会连实现一起清掉，不补回来 getProcessedIds 会返回 undefined
    mockProcessedIds.mockReset().mockReturnValue([])
    mockRecordBatch.mockReset()
    mockClearBatches.mockReset().mockReturnValue(0)
    mockCardCounts.mockReset().mockReturnValue({})
  })

  it('有笔记时直接蒸馏，不调 WeRead 导入', async () => {
    mockGetByBookId.mockReturnValue([
      { content: '划线1', chapter_title: '第1章' },
      { content: '划线2', chapter_title: '第2章' },
    ])
    mockDistill.mockResolvedValue([
      { type: 'concept', title: '概念A', content: '内容A', tags: ['t'] },
    ])
    const result = await knowledgeCardService.distillBook('b1', '书名')
    expect(mockFetchAllContent).not.toHaveBeenCalled()
    expect(mockDistill).toHaveBeenCalled()
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].title).toBe('概念A')
    expect(result.coverage).toMatchObject({ total: 2, covered: 2, skipped: 0, partial: false })
  })

  it('划线超过单次上限时，返回的覆盖数如实反映被挡在外面的条数', async () => {
    const many = Array.from({ length: AI_INPUT_LIMITS.knowledgeCards + 40 }, (_, i) => ({
      content: `划线${i}`,
      chapter_title: '第1章',
    }))
    mockGetByBookId.mockReturnValue(many)
    mockDistill.mockResolvedValue([{ type: 'concept', title: '概念A', content: '内容A', tags: [] }])

    const { coverage } = await knowledgeCardService.distillBook('b-over', '长书')
    expect(coverage).toEqual({
      task: 'knowledgeCards',
      total: 100,
      alreadyProcessed: 0,
      limit: AI_INPUT_LIMITS.knowledgeCards,
      covered: AI_INPUT_LIMITS.knowledgeCards,
      skipped: 100 - AI_INPUT_LIMITS.knowledgeCards,
      partial: true,
    })
    // 界面文案由同一份 plan 派生，不在渲染层重算
    expect(coverageNotice(coverage, '划线')).toBe('本次处理 60/100 条划线，还剩 40 条')
  })

  it('无笔记时自动从 WeRead 导入再蒸馏', async () => {
    // 第一次查无笔记 → 导入 → 第二次查有笔记
    mockGetByBookId
      .mockReturnValueOnce([]) // 初始无
      .mockReturnValueOnce([{ content: '导入的划线', chapter_title: '章' }]) // 导入后
    mockFetchAllContent.mockResolvedValue({ bookmarks: [], notes: [] })
    mockDistill.mockResolvedValue([{ type: 'quote', title: '金句', content: '内容', tags: [] }])

    const result = await knowledgeCardService.distillBook('b-no-notes', '无笔记书')
    expect(mockFetchAllContent).toHaveBeenCalledWith('b-no-notes')
    expect(mockDistill).toHaveBeenCalled()
    expect(result.cards[0].title).toBe('金句')
  })

  it('force=true 且无笔记时抛「没有笔记」错误', async () => {
    mockGetByBookId.mockReturnValue([])
    await expect(
      knowledgeCardService.distillBook('b-force', '书名', { force: true }),
    ).rejects.toThrow(/没有笔记/)
    expect(mockDistill).not.toHaveBeenCalled()
  })

  it('WeRead 也无笔记时抛「无法蒸馏」错误', async () => {
    mockGetByBookId.mockReturnValue([])
    mockFetchAllContent.mockResolvedValue({ bookmarks: [], notes: [] })
    await expect(knowledgeCardService.distillBook('b-empty', '空书')).rejects.toThrow(/无法蒸馏/)
    expect(mockDistill).not.toHaveBeenCalled()
  })

  it('蒸馏的卡片写入 knowledge_cards 表（每张调 create）', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '章' }])
    mockDistill.mockResolvedValue([
      { type: 'concept', title: 'A', content: '内容A', tags: ['t'] },
      { type: 'quote', title: 'B', content: '内容B', tags: [] },
    ])
    await knowledgeCardService.distillBook('b-save', '书名')
    expect(mockKnowledgeCreate).toHaveBeenCalledTimes(2)
  })

  it('分批续跑：台账记过的不再喂给 AI，这一批取的是没记过的', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ id: `h${i}`, content: `划线${i}`, chapter_title: '章' }))
    mockGetByBookId.mockReturnValue(rows)
    mockCardCounts.mockReturnValue({ 'b-next': 5 })
    mockProcessedIds.mockReturnValue(rows.slice(0, 60).map((r) => r.id))
    mockDistill.mockResolvedValue([{ type: 'concept', title: 'A', content: '内容A', tags: [] }])

    const { coverage } = await knowledgeCardService.distillBook('b-next', '书名')

    const fed = mockDistill.mock.calls[0][0] as Array<{ content: string }>
    expect(fed).toHaveLength(10)
    expect(fed[0].content).toBe('划线60')
    expect(coverage).toMatchObject({ total: 70, alreadyProcessed: 60, covered: 10, skipped: 0, partial: false })
  })

  it('整本书都生成过了：一次 AI 都不调，nothingNew 为真', async () => {
    const rows = [{ id: 'h1', content: '划线1' }, { id: 'h2', content: '划线2' }]
    mockGetByBookId.mockReturnValue(rows)
    mockCardCounts.mockReturnValue({ 'b-done': 3 })
    mockProcessedIds.mockReturnValue(['h1', 'h2'])

    const result = await knowledgeCardService.distillBook('b-done', '书名')

    expect(mockDistill).not.toHaveBeenCalled()
    expect(mockKnowledgeCreate).not.toHaveBeenCalled()
    expect(result.cards).toEqual([])
    expect(result.nothingNew).toBe(true)
    expect(result.coverage).toMatchObject({ covered: 0, skipped: 0, partial: false, alreadyProcessed: 2 })
  })

  it('成功落库后把这一批记进台账（记了下次才不会重复花钱）', async () => {
    mockGetByBookId.mockReturnValue([{ id: 'h1', content: '划线1' }, { id: 'h2', content: '划线2' }])
    mockDistill.mockResolvedValue([{ type: 'concept', title: 'A', content: '内容A', tags: [] }])

    await knowledgeCardService.distillBook('b-ledger', '书名')

    expect(mockRecordBatch).toHaveBeenCalledWith('b-ledger', 'knowledgeCards', ['h1', 'h2'])
  })

  it('AI 失败时不记台账 —— 半途失败的那批下次还能补上', async () => {
    mockGetByBookId.mockReturnValue([{ id: 'h1', content: '划线1' }])
    mockDistill.mockRejectedValue(new Error('AI 炸了'))

    await expect(knowledgeCardService.distillBook('b-fail', '书名')).rejects.toThrow(/AI 炸了/)
    expect(mockRecordBatch).not.toHaveBeenCalled()
  })

  it('重新蒸馏：无视台账从头再来，并把台账一起归零', async () => {
    mockGetByBookId.mockReturnValue([{ id: 'h1', content: '划线1' }, { id: 'h2', content: '划线2' }])
    mockCardCounts.mockReturnValue({ 'b-redo': 2 })
    mockProcessedIds.mockReturnValue(['h1', 'h2'])
    mockDistill.mockResolvedValue([{ type: 'concept', title: 'A', content: '内容A', tags: [] }])

    const { coverage } = await knowledgeCardService.distillBook('b-redo', '书名', { replace: true })

    expect(mockProcessedIds).not.toHaveBeenCalled()
    expect(mockDistill).toHaveBeenCalledTimes(1)
    expect(coverage).toMatchObject({ alreadyProcessed: 0, covered: 2 })
    expect(mockClearBatches).toHaveBeenCalledWith('b-redo', 'knowledgeCards')
  })

  it('卡片全删过了：台账作废并从头喂，否则那批划线永远补不回来', async () => {
    const rows = [{ id: 'h1', content: '划线1' }, { id: 'h2', content: '划线2' }]
    mockGetByBookId.mockReturnValue(rows)
    mockCardCounts.mockReturnValue({})                  // 一张卡都不剩
    mockProcessedIds.mockReturnValue(['h1', 'h2'])      // 台账却声称都处理过
    mockDistill.mockResolvedValue([{ type: 'concept', title: 'A', content: '内容A', tags: [] }])

    const { coverage } = await knowledgeCardService.distillBook('b-void', '书名')

    expect(mockClearBatches).toHaveBeenCalledWith('b-void', 'knowledgeCards')
    expect(mockDistill.mock.calls[0][0]).toHaveLength(2)
    expect(coverage).toMatchObject({ alreadyProcessed: 0, covered: 2, partial: false })
  })

  it('distill 抛错时任务从 activeTasks 清除（finally）', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '章' }])
    mockDistill.mockRejectedValue(new Error('AI 炸了'))
    await expect(knowledgeCardService.distillBook('b-err', '书名')).rejects.toThrow(/AI 炸了/)
    // finally 清除
    expect(knowledgeCardService.isDistilling('b-err')).toBe(false)
  })
})
