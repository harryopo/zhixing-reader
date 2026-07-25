// 知行读书 — agent builders 单元测试（2026-07-24，过夜 Task #10）
//
// 覆盖 5 个上下文构建器的 shouldBuild 决策 + build 内容组装 + 错误降级。
// 这些 builder 是 agent 上下文构建的数据来源，0 单测。
// methodology/memory/user-profile 是纯 DB 查询，用测试 fixture；
// book 依赖 RAG，mock rag-service。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

// Mock rag-service（book builder 依赖）— vi.hoisted 避免 hoist 引用问题
const { mockSemanticSearch, mockCheckRAGAvailability, mockKeywordSearch } = vi.hoisted(() => ({
  mockSemanticSearch: vi.fn(),
  mockCheckRAGAvailability: vi.fn(),
  mockKeywordSearch: vi.fn(),
}))

vi.mock('../electron/services/rag-service', () => ({
  semanticSearch: mockSemanticSearch,
  checkRAGAvailability: mockCheckRAGAvailability,
  keywordSearch: mockKeywordSearch,
}))

vi.mock('../electron/agent/system-prompt', () => ({
  CONTEXT_OVERFLOW_HINT: '\n（以上为相关笔记）',
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { BookContextBuilder } from '../electron/agent/builders/book-context-builder'
import { MethodologyContextBuilder } from '../electron/agent/builders/methodology-context-builder'
import { KnowledgeCardContextBuilder } from '../electron/agent/builders/knowledge-card-context-builder'
import { MemoryContextBuilder } from '../electron/agent/builders/memory-context-builder'
import { UserProfileContextBuilder } from '../electron/agent/builders/user-profile-context-builder'
import { methodologiesDb, knowledgeCardsDb, memoriesDb, booksDb } from '../electron/database'
import type { BuildContext } from '../electron/agent/context-builder'

const ctxWithBook = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  sessionId: 's1',
  bookId: 'b1',
  userMessage: '什么是元认知',
  conversationHistory: [],
  intent: 'knowledge_query',
  ...overrides,
})

describe('BookContextBuilder', () => {
  let builder: BookContextBuilder

  beforeEach(() => {
    builder = new BookContextBuilder()
    vi.clearAllMocks()
  })

  describe('shouldBuild', () => {
    it('无 bookId 时返回 false', () => {
      expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(false)
    })

    it('有 bookId 且首次对话（无历史）时返回 true', () => {
      expect(builder.shouldBuild(ctxWithBook({ conversationHistory: [] }))).toBe(true)
    })

    it('有历史且意图为 knowledge_query 时返回 true', () => {
      expect(
        builder.shouldBuild(ctxWithBook({ conversationHistory: [{ role: 'user', content: 'x' }], intent: 'knowledge_query' })),
      ).toBe(true)
    })

    it('有历史且意图为 deep_discussion 时返回 true', () => {
      expect(
        builder.shouldBuild(ctxWithBook({ conversationHistory: [{ role: 'user', content: 'x' }], intent: 'deep_discussion' })),
      ).toBe(true)
    })

    it('有历史且意图为 casual_chat 时返回 false', () => {
      expect(
        builder.shouldBuild(ctxWithBook({ conversationHistory: [{ role: 'user', content: 'x' }], intent: 'casual_chat' })),
      ).toBe(false)
    })
  })

  describe('build', () => {
    it('RAG 可用时走语义搜索', async () => {
      mockCheckRAGAvailability.mockResolvedValue(true)
      mockSemanticSearch.mockResolvedValue([
        { content: '笔记内容', bookTitle: '书名', chapterTitle: '第1章', relevanceScore: 0.9 },
      ])
      const result = await builder.build(ctxWithBook())
      expect(mockSemanticSearch).toHaveBeenCalled()
      expect(result.content).toContain('笔记内容')
      expect(result.content).toContain('第1章')
      expect(result.metadata?.source).toBe('rag')
    })

    it('RAG 不可用时降级到关键词匹配', async () => {
      mockCheckRAGAvailability.mockResolvedValue(false)
      mockKeywordSearch.mockReturnValue([
        { content: '关键词笔记', bookTitle: '书名', chapterTitle: '第2章' },
      ])
      const result = await builder.build(ctxWithBook())
      expect(mockKeywordSearch).toHaveBeenCalled()
      expect(result.content).toContain('关键词笔记')
    })

    it('无检索结果时返回空 content', async () => {
      mockCheckRAGAvailability.mockResolvedValue(true)
      mockSemanticSearch.mockResolvedValue([])
      const result = await builder.build(ctxWithBook())
      expect(result.content).toBe('')
    })

    it('RAG 抛错时降级到关键词匹配', async () => {
      mockCheckRAGAvailability.mockResolvedValue(true)
      mockSemanticSearch.mockRejectedValue(new Error('RAG boom'))
      mockKeywordSearch.mockReturnValue([
        { content: '降级笔记', bookTitle: '书', chapterTitle: '章' },
      ])
      const result = await builder.build(ctxWithBook())
      expect(result.content).toContain('降级笔记')
    })
  })
})

describe('MethodologyContextBuilder', () => {
  let builder: MethodologyContextBuilder

  beforeEach(async () => {
    await setupTestDatabase()
    builder = new MethodologyContextBuilder()
    // 准备一本书 + 方法论
    booksDb.create({ id: 'b1', title: '认知觉醒' } as never)
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('shouldBuild：无 bookId 返回 false', () => {
    expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(false)
  })

  it('shouldBuild：有 bookId 返回 true', () => {
    expect(builder.shouldBuild(ctxWithBook())).toBe(true)
  })

  it('无方法论时返回空 content', () => {
    const result = builder.build(ctxWithBook())
    expect(result.content).toBe('')
  })

  it('有方法论时组装上下文含名称/描述/步骤', () => {
    methodologiesDb.create({
      id: 'm1',
      book_id: 'b1',
      name: '费曼方法',
      name_en: 'Feynman',
      trigger_scenario: '需要学会一个概念时',
      description: '用简单语言解释',
      // steps 需传数组，create 内部会 JSON.stringify
      steps: ['选概念', '解释', '查漏', '简化'],
      mastery_level: 30,
    })
    const result = builder.build(ctxWithBook())
    expect(result.content).toContain('费曼方法')
    expect(result.content).toContain('Feynman')
    expect(result.content).toContain('触发场景')
    expect(result.content).toContain('选概念')
    expect(result.content).toContain('掌握度')
  })

  it('步骤 JSON 解析失败时跳过步骤不报错', () => {
    // create 会 JSON.stringify('not-valid-json') 得到 '"not-valid-json"'，
    // builder 内部 JSON.parse 再得到字符串 'not-valid-json'（非数组），应跳过
    methodologiesDb.create({
      id: 'm2',
      book_id: 'b1',
      name: '坏步骤方法',
      steps: 'not-valid-json',
    })
    const result = builder.build(ctxWithBook())
    expect(result.content).toContain('坏步骤方法')
    // 步骤非数组时不输出「步骤:」行
    expect(result.content).not.toContain('步骤: ')
  })
})

describe('KnowledgeCardContextBuilder', () => {
  let builder: KnowledgeCardContextBuilder

  beforeEach(async () => {
    await setupTestDatabase()
    builder = new KnowledgeCardContextBuilder()
    booksDb.create({ id: 'b1', title: '认知觉醒' } as never)
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('shouldBuild：无 bookId 返回 false', () => {
    expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(false)
  })

  it('无知识卡片时返回空 content', () => {
    const result = builder.build(ctxWithBook())
    expect(result.content).toBe('')
  })

  it('有知识卡片时组装上下文', () => {
    knowledgeCardsDb.create({
      id: 'kc1',
      book_id: 'b1',
      type: 'concept',
      title: '元认知',
      content: '对思考的思考',
      interpretation: '元认知是...',
      tags: '["认知","思维"]',
    } as never)
    const result = builder.build(ctxWithBook())
    expect(result.content).toContain('元认知')
    expect(result.content).toContain('对思考的思考')
  })
})

describe('MemoryContextBuilder', () => {
  let builder: MemoryContextBuilder

  beforeEach(async () => {
    await setupTestDatabase()
    builder = new MemoryContextBuilder()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('shouldBuild 有记忆时返回 true，无记忆时返回 false', async () => {
    // 无记忆
    expect(builder.shouldBuild(ctxWithBook())).toBe(false)
    // 加一条记忆
    memoriesDb.create({ type: 'preference', category: 'reading', content: '喜欢认知科学', importance: 0.8 })
    expect(builder.shouldBuild(ctxWithBook())).toBe(true)
  })

  it('无记忆时返回空 content', () => {
    const result = builder.build(ctxWithBook())
    expect(result.content).toBe('')
  })

  it('有记忆时组装上下文含偏好/洞察', () => {
    memoriesDb.create({ type: 'preference', category: 'reading', content: '喜欢认知科学', importance: 0.8 })
    memoriesDb.create({ type: 'insight', category: 'learning', content: '元认知很重要', importance: 0.7 })
    const result = builder.build(ctxWithBook())
    expect(result.content).toContain('喜欢认知科学')
    expect(result.content).toContain('元认知很重要')
  })
})

describe('UserProfileContextBuilder', () => {
  let builder: UserProfileContextBuilder

  beforeEach(() => {
    builder = new UserProfileContextBuilder()
  })

  it('shouldBuild 始终返回 false（当前禁用）', () => {
    expect(builder.shouldBuild(ctxWithBook())).toBe(false)
  })

  it('build 无画像时返回空 content（await Promise）', async () => {
    const result = await builder.build(ctxWithBook())
    // hasUserProfile() false → personalizedPrompt 空 → content 为 ''
    expect(result.content).toBe('')
  })
})
