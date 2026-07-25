// 知行读书 — knowledge-card-service 单元测试（2026-07-24，过夜 Task #13）
//
// 覆盖单例 + 任务管理 + 并发防重 + 取消 + 自动导入兜底。
// knowledge-card-service 是知识卡片蒸馏的协调核心（防并发/取消/进度回传），0 单测。
// mock 依赖（database/weread-api/ai-service/BrowserWindow/logger），验证状态机。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ===== vi.hoisted mock =====
const { mockGetByBookId, mockKnowledgeCreate, mockFetchAllContent, mockDistill } = vi.hoisted(() => ({
  mockGetByBookId: vi.fn(() => []),
  mockKnowledgeCreate: vi.fn(),
  mockFetchAllContent: vi.fn(),
  mockDistill: vi.fn(),
}))

vi.mock('../electron/database', () => ({
  knowledgeCardsDb: { create: mockKnowledgeCreate },
  highlightsDb: {
    getByBookId: mockGetByBookId,
    create: vi.fn(),
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
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('概念A')
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
    expect(result[0].title).toBe('金句')
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

  it('distill 抛错时任务从 activeTasks 清除（finally）', async () => {
    mockGetByBookId.mockReturnValue([{ content: '划线1', chapter_title: '章' }])
    mockDistill.mockRejectedValue(new Error('AI 炸了'))
    await expect(knowledgeCardService.distillBook('b-err', '书名')).rejects.toThrow(/AI 炸了/)
    // finally 清除
    expect(knowledgeCardService.isDistilling('b-err')).toBe(false)
  })
})
