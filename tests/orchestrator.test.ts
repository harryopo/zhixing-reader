// 知行读书 — orchestrator 单元测试（2026-07-24，过夜 Task #9）
//
// 覆盖 processMessageStream 的编排逻辑：意图→策略→难度→上下文→流式 全链路。
// orchestrator 是 agent 编排核心，0 单测。mock 所有子模块（ai-sdk-service / builders / db），
// 验证：升降级后 strategy 被正确改写、上下文拼装、流式回调透传、记忆/掌握度后处理。

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ===== Mock 依赖模块 =====
// vi.mock 是 hoisted，工厂函数内不能引用外部顶层变量，用 vi.hoisted 提前定义
const {
  mockStreamChat,
  mockClassifyIntent,
  mockSelectStrategy,
  mockGetSystemPrompt,
  mockExtractMemories,
  mockMethodologiesDb,
  mockConversationDb,
  mockSummarize,
} = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
  mockClassifyIntent: vi.fn(),
  mockSelectStrategy: vi.fn(),
  mockGetSystemPrompt: vi.fn(),
  mockExtractMemories: vi.fn(),
  // 签名对齐生产：`methodologiesDb.getByBookId(): Record<string, unknown>[]`、
  // `conversationDb.getHistorySummary(): string | null`。
  // 不写返回类型会被推成 `never[]` / `null`，后面 mockReturnValue 喂真数据全判红。
  mockMethodologiesDb: {
    getByBookId: vi.fn((): Record<string, unknown>[] => []),
    getById: vi.fn((id: string): Record<string, unknown> | undefined =>
      id === 'm1' ? { id: 'm1', name: '费曼方法', mastery_level: 10, practice_count: 2 } : undefined,
    ),
    update: vi.fn(),
  },
  mockConversationDb: { getHistorySummary: vi.fn((): string | null => null), setHistorySummary: vi.fn() },
  mockSummarize: vi.fn(),
}))

vi.mock('../electron/ai-sdk-service', () => ({
  sdkStreamChat: mockStreamChat,
}))

vi.mock('../electron/agent/intent-classifier', () => ({
  classifyIntent: mockClassifyIntent,
}))

vi.mock('../electron/agent/strategy-selector', () => ({
  selectStrategy: mockSelectStrategy,
  strategyToPromptHint: vi.fn((s: { teachingMode: string }) =>
    s.teachingMode === 'socratic' ? '苏格拉底' : '',
  ),
}))

vi.mock('../electron/agent/system-prompt', () => ({
  getSystemPrompt: mockGetSystemPrompt,
}))

vi.mock('../electron/agent/state-tracker', () => ({
  getOrCreateState: vi.fn((sid: string) => ({
    sessionId: sid,
    currentBloomLevel: 1,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    conceptStates: new Map(),
    recentTopics: [],
    lastActivity: new Date(),
  })),
  adjustDifficulty: vi.fn(() => ({ action: 'maintain', reason: '保持' })),
  updateConceptMastery: vi.fn(),
  clearState: vi.fn(),
}))

vi.mock('../electron/services/memory-service', () => ({
  extractMemoriesFromConversation: mockExtractMemories,
}))

vi.mock('../electron/services/prompt-storage', () => ({
  getPromptTemplate: vi.fn(() => ''),
}))

vi.mock('../electron/database', () => ({
  methodologiesDb: mockMethodologiesDb,
  conversationDb: mockConversationDb,
}))

// 历史滚动摘要器（Step 3）：默认返回空串（不折叠），折叠行为在具体用例内单独驱动
vi.mock('../electron/agent/history-summarizer', () => ({
  summarizeHistoryIncremental: mockSummarize,
}))

// ContextManager 用真实实现，但注册的 builder 用 stub
vi.mock('../electron/agent/builders/book-context-builder', () => ({
  BookContextBuilder: class {
    name = 'book'
    priority = 100
    shouldBuild = () => true
    build = async () => ({ content: '书籍上下文', priority: 100 })
  },
}))
vi.mock('../electron/agent/builders/methodology-context-builder', () => ({
  MethodologyContextBuilder: class {
    name = 'methodology'
    priority = 80
    shouldBuild = () => true
    build = async () => ({ content: '方法论上下文', priority: 80 })
  },
}))
vi.mock('../electron/agent/builders/knowledge-card-context-builder', () => ({
  KnowledgeCardContextBuilder: class {
    name = 'knowledge-card'
    priority = 70
    shouldBuild = () => false
    build = async () => ({ content: '', priority: 70 })
  },
}))
vi.mock('../electron/agent/builders/memory-context-builder', () => ({
  MemoryContextBuilder: class {
    name = 'memory'
    priority = 50
    shouldBuild = () => false
    build = async () => ({ content: '', priority: 50 })
  },
}))
vi.mock('../electron/agent/builders/user-profile-context-builder', () => ({
  UserProfileContextBuilder: class {
    name = 'user-profile'
    priority = 10
    shouldBuild = () => false
    build = async () => ({ content: '', priority: 10 })
  },
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { processMessageStream, clearState, type RetrievalStatus } from '../electron/agent/orchestrator'

describe('orchestrator — processMessageStream 编排逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClassifyIntent.mockResolvedValue('knowledge_query')
    mockSelectStrategy.mockReturnValue({
      teachingMode: 'direct_answer',
      bloomLevel: 1,
    })
    mockGetSystemPrompt.mockReturnValue('你是知行读书AI')
    mockStreamChat.mockImplementation(
      async (
        _messages: unknown,
        onChunk: (c: string) => void,
        onComplete: (u?: { promptTokens: number; completionTokens: number }) => void,
      ) => {
        onChunk('回答')
        onComplete({ promptTokens: 10, completionTokens: 5 })
      },
    )
    mockExtractMemories.mockImplementation(() => {})
    // 默认不折叠：返回空 → ensureSummaryFresh 视为无变化，wire 不 trim
    mockSummarize.mockResolvedValue('')
  })

  it('正常流程：分类→策略→上下文→流式→完成', async () => {
    const chunks: string[] = []
    let completed = false
    let usage: { promptTokens: number; completionTokens: number } | undefined

    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '什么是元认知？',
      (c) => chunks.push(c),
      (u) => {
        completed = true
        usage = u
      },
      () => {},
    )

    expect(mockClassifyIntent).toHaveBeenCalledWith('什么是元认知？', [])
    expect(mockSelectStrategy).toHaveBeenCalledWith('knowledge_query')
    expect(mockStreamChat).toHaveBeenCalled()
    expect(chunks).toEqual(['回答'])
    expect(completed).toBe(true)
    expect(usage).toEqual({ promptTokens: 10, completionTokens: 5 })
  })

  it('流式 chunk 透传给 onChunk', async () => {
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void) => {
        onChunk('A')
        onChunk('B')
        onChunk('C')
      },
    )
    const chunks: string[] = []
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '问题',
      (c) => chunks.push(c),
      () => {},
      () => {},
    )
    expect(chunks).toEqual(['A', 'B', 'C'])
  })

  it('sdkStreamChat 抛错时透传给 onError', async () => {
    mockStreamChat.mockImplementation(
      async (_m: unknown, _onChunk: unknown, _onComplete: unknown, onError: (e: Error) => void) => {
        onError(new Error('网络错误'))
      },
    )
    // 用对象持有而不是 `let capturedError: Error | null = null`：回调里的赋值 TS 看不见，
    // let 变量的 narrowing 会停在 null，`capturedError?.message` 直接被判成 never
    const captured: { error: Error | null } = { error: null }
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      (e) => {
        captured.error = e
      },
    )
    expect(captured.error?.message).toBe('网络错误')
  })

  it('完成后调用记忆提取（extractMemoriesFromConversation）', async () => {
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '我喜欢费曼方法',
      () => {},
      () => {},
      () => {},
    )
    // onComplete 触发后应调 extractMemories
    expect(mockExtractMemories).toHaveBeenCalled()
  })

  /*
    练习记账的判据（2026-09-24 改）：只有"这一轮带着某条方法论进来练"才算练过。
    以前是在 AI 的回答文本里找方法论名字，命中就 +1 —— 模型顺嘴提一句，
    界面上用户就"练过一次"，数字溯不到任何用户动作。
  */
  it('带 methodologyId 的一轮：查这一条并记一次练习', async () => {
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', methodologyId: 'm1', conversationHistory: [] },
      '我来练费曼方法',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.getById).toHaveBeenCalledWith('m1')
    expect(mockMethodologiesDb.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ practice_count: 3 }),
    )
  })

  it('回答里出现方法论名、但这轮没带 methodologyId → 一分都不记', async () => {
    mockMethodologiesDb.getByBookId.mockReturnValue([
      { id: 'm1', name: '费曼方法', name_en: 'Feynman', mastery_level: 10, practice_count: 2 },
    ])
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void, onComplete: () => void) => {
        onChunk('我们可以用费曼方法（Feynman）来学习这个概念')
        onComplete()
      },
    )
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '随便问问',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.update).not.toHaveBeenCalled()
    // 反证：这一轮确实跑完了（不是提前 return 才没调用）
    expect(mockStreamChat).toHaveBeenCalled()
  })

  it('没带 methodologyId 时不去按书名捞一整本书的方法论', async () => {
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.getByBookId).not.toHaveBeenCalled()
  })

  it('对话历史以 wire 视图原样传给 LLM（上限 40 条，替代旧 8 条截断）', async () => {
    // 清理前序测试累积的 wire 缓存（模块级 Map，sessionId 复用）
    clearState('s1')
    let capturedMessages: Array<{ role: string; content: string }> = []
    mockStreamChat.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        capturedMessages = messages
      },
    )
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg${i}`,
    }))
    await processMessageStream(
      { sessionId: 's1', conversationHistory: history },
      '新问题',
      () => {},
      () => {},
      () => {},
    )
    // system + 15 条 wire 历史（原样重发，≤40 不裁剪）+ 1 条新 user = 17
    expect(capturedMessages).toHaveLength(17)
    expect(capturedMessages[0].role).toBe('system')
    expect(capturedMessages[1]).toEqual({ role: 'user', content: 'msg0' })
    expect(capturedMessages[capturedMessages.length - 1].content).toContain('新问题')
  })

  it('对话历史超过 40 条时 wire 视图裁剪到上限', async () => {
    clearState('s1')
    let capturedMessages: Array<{ role: string; content: string }> = []
    mockStreamChat.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        capturedMessages = messages
      },
    )
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg${i}`,
    }))
    await processMessageStream(
      { sessionId: 's1', conversationHistory: history },
      '新问题',
      () => {},
      () => {},
      () => {},
    )
    // system + 40 条 wire（裁剪到上限）+ 1 条新 user = 42
    expect(capturedMessages).toHaveLength(42)
    // 裁剪后最老一条是 msg10（50 - 40）
    expect(capturedMessages[1].content).toBe('msg10')
  })

  it('wire 历史超阈值时折叠最老轮次进摘要并注入 system 块（Step 3）', async () => {
    clearState('s1')
    mockConversationDb.getHistorySummary.mockReturnValue(null)
    mockSummarize.mockResolvedValue('用户目标：理解元认知。已确认事实：X。')
    let capturedMessages: Array<{ role: string; content: string }> = []
    mockStreamChat.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        capturedMessages = messages
      },
    )
    // 30 条历史（≤40 不触发 wire 裁剪，但 >24 触发摘要折叠）
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg${i}`,
    }))
    await processMessageStream(
      { sessionId: 's1', conversationHistory: history },
      '新问题',
      () => {},
      () => {},
      () => {},
    )
    // 折叠：keep 12 → toFold = 前 18 条；wire trim 到 msg18..msg29（12 条）
    // messages = system(主) + system(摘要) + 12 wire + 1 user = 15
    expect(capturedMessages).toHaveLength(15)
    expect(capturedMessages[0].role).toBe('system')
    expect(capturedMessages[1].role).toBe('system')
    expect(capturedMessages[1].content).toContain('滚动摘要')
    expect(capturedMessages[1].content).toContain('用户目标：理解元认知')
    // 折叠后 wire 最老一条是 msg18（30 - 12）
    expect(capturedMessages[2].content).toBe('msg18')
    // 摘要持久化到 DB
    expect(mockConversationDb.setHistorySummary).toHaveBeenCalledWith(
      's1',
      '用户目标：理解元认知。已确认事实：X。',
    )
  })

  it('已有持久化摘要时（重启后）即使未超阈值也注入摘要块', async () => {
    clearState('s1')
    mockConversationDb.getHistorySummary.mockReturnValue('早期对话的摘要：用户在读《认知觉醒》。')
    let capturedMessages: Array<{ role: string; content: string }> = []
    mockStreamChat.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        capturedMessages = messages
      },
    )
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '继续上次的话题',
      () => {},
      () => {},
      () => {},
    )
    // system(主) + system(持久摘要) + 0 wire + 1 user = 3
    expect(capturedMessages).toHaveLength(3)
    expect(capturedMessages[1].role).toBe('system')
    expect(capturedMessages[1].content).toContain('用户在读《认知觉醒》')
  })

  it('发射检索可视化事件：start + done（各路来源带中文标签）', async () => {
    clearState('s1')
    const events: RetrievalStatus[] = []
    mockStreamChat.mockImplementation(async () => {})
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      () => {},
      { onRetrieval: (status) => events.push(status) },
    )
    expect(events[0]).toEqual({ stage: 'start' })
    const done = events.find(e => e.stage === 'done')
    expect(done?.stage).toBe('done')
    const labels = done && done.stage === 'done' ? done.sources.map(s => s.label) : []
    // builder stub 中 book + methodology 的 shouldBuild 返回 true
    expect(labels).toContain('书籍笔记')
    expect(labels).toContain('方法论')
  })

  it('clearState 导出（清理会话）', () => {
    expect(typeof clearState).toBe('function')
  })
})
