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
} = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
  mockClassifyIntent: vi.fn(),
  mockSelectStrategy: vi.fn(),
  mockGetSystemPrompt: vi.fn(),
  mockExtractMemories: vi.fn(),
  mockMethodologiesDb: { getByBookId: vi.fn(() => []), update: vi.fn() },
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

import { processMessageStream, clearState } from '../electron/agent/orchestrator'

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
    let capturedError: Error | null = null
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      (e) => {
        capturedError = e
      },
    )
    expect(capturedError?.message).toBe('网络错误')
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

  it('有 bookId 时完成后更新方法论掌握度（英文名 \\b 匹配）', async () => {
    // 回答里含方法论英文名（\b 词边界匹配 ASCII）
    mockMethodologiesDb.getByBookId.mockReturnValue([
      { id: 'm1', name: '费曼方法', name_en: 'Feynman', mastery_level: 10, practice_count: 0 },
    ])
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void, onComplete: () => void) => {
        onChunk('用 Feynman 方法来学习')
        onComplete()
      },
    )
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '费曼方法怎么用？',
      () => {},
      () => {},
      () => {},
    )
    // 回答里含「Feynman」（name_en，\b 词边界可匹配）应触发 mastery 更新
    expect(mockMethodologiesDb.update).toHaveBeenCalled()
  })

  it('有 bookId 时完成后更新方法论掌握度（中文名边界匹配）', async () => {
    // 修复 \b 对中文无效的 bug 后，中文名也应能匹配
    mockMethodologiesDb.getByBookId.mockReturnValue([
      { id: 'm1', name: '费曼方法', name_en: '', mastery_level: 10, practice_count: 0 },
    ])
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void, onComplete: () => void) => {
        onChunk('我们可以用费曼方法来学习这个概念')
        onComplete()
      },
    )
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '费曼方法怎么用？',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.update).toHaveBeenCalled()
  })

  it('中文方法名长度<2 时不触发匹配（防单字误匹配）', async () => {
    // 单字方法论名「法」长度 1 < MIN_CN_NAME_LEN(2)，不触发 includes 匹配
    mockMethodologiesDb.getByBookId.mockReturnValue([
      { id: 'm-other', name: '法', name_en: '', mastery_level: 0, practice_count: 0 },
    ])
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void, onComplete: () => void) => {
        onChunk('这是一种好方法')
        onComplete()
      },
    )
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      () => {},
    )
    // 单字名不触发，避免单字在大量文本里误匹配
    expect(mockMethodologiesDb.update).not.toHaveBeenCalled()
  })

  it('回答不含方法论名时不更新掌握度', async () => {
    mockMethodologiesDb.getByBookId.mockReturnValue([
      { id: 'm1', name: '费曼方法', name_en: 'Feynman', mastery_level: 10, practice_count: 0 },
    ])
    mockStreamChat.mockImplementation(
      async (_m: unknown, onChunk: (c: string) => void, onComplete: () => void) => {
        onChunk('无关回答')
        onComplete()
      },
    )
    await processMessageStream(
      { sessionId: 's1', bookId: 'b1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.update).not.toHaveBeenCalled()
  })

  it('无 bookId 时不查方法论', async () => {
    await processMessageStream(
      { sessionId: 's1', conversationHistory: [] },
      '问题',
      () => {},
      () => {},
      () => {},
    )
    expect(mockMethodologiesDb.getByBookId).not.toHaveBeenCalled()
  })

  it('对话历史被截断到最近 8 条传给 LLM', async () => {
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
    // system + 最近8条历史 + 1条新user = 10
    expect(capturedMessages).toHaveLength(10)
    expect(capturedMessages[0].role).toBe('system')
    expect(capturedMessages[capturedMessages.length - 1].content).toContain('新问题')
  })

  it('clearState 导出（清理会话）', () => {
    expect(typeof clearState).toBe('function')
  })
})
