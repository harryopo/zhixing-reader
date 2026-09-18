// 知行读书 — agent builders 单元测试（2026-07-24，过夜 Task #10）
//
// 覆盖 5 个上下文构建器的 shouldBuild 决策 + build 内容组装 + 错误降级。
// 这些 builder 是 agent 上下文构建的数据来源，0 单测。
// methodology/memory/user-profile 是纯 DB 查询，用测试 fixture；
// book 依赖 RAG，mock rag-service。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

// Mock rag-service（book builder 依赖本地检索）— vi.hoisted 避免 hoist 引用问题
//
// 2026-09-16：检索只剩一条路（本地 BM25）。原来的 semanticSearch / checkRAGAvailability /
// keywordSearch 三件套已整套删除，mock 也随之收敛成一个 retrieveHighlights。
const { mockRetrieveHighlights } = vi.hoisted(() => ({
  mockRetrieveHighlights: vi.fn(),
}))

vi.mock('../electron/services/rag-service', () => ({
  retrieveHighlights: mockRetrieveHighlights,
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
import { methodologiesDb, knowledgeCardsDb, memoriesDb, booksDb, chapterSummariesDb, bookSummariesDb } from '../electron/database'
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
    it('无 bookId 时也返回 true（此时跨全部书籍检索）', () => {
      expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(true)
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

    it('有历史且意图为 casual_chat 时仍返回 true（选书即注入，修复"选了书却说没笔记"）', () => {
      expect(
        builder.shouldBuild(ctxWithBook({ conversationHistory: [{ role: 'user', content: 'x' }], intent: 'casual_chat' })),
      ).toBe(true)
    })
  })

  describe('build', () => {
    it("检索到划线时写进上下文，并标记 method=local", async () => {
      mockRetrieveHighlights.mockResolvedValue([
        {
          highlightId: 'hl_1',
          bookId: 'b1',
          content: '笔记内容',
          bookTitle: '书名',
          chapterTitle: '第1章',
          relevanceScore: 0.9,
        },
      ])
      const result = await builder.build(ctxWithBook())
      expect(mockRetrieveHighlights).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bookId: 'b1' }),
      )
      expect(result.content).toContain('笔记内容')
      expect(result.content).toContain('第1章')
      expect(result.metadata?.source).toBe('rag')
      expect(result.metadata?.method).toBe('local')
      expect(result.metadata?.itemCount).toBe(1)
      expect(result.metadata?.topScore).toBe(0.9)
      expect(result.metadata?.previews?.[0]).toMatchObject({ title: '第1章', snippet: '笔记内容' })
    })

    it("检索不到时上下文为空（不给 AI 编内容）", async () => {
      mockRetrieveHighlights.mockResolvedValue([])
      const result = await builder.build(ctxWithBook())
      expect(result.content).toBe('')
    })

    it("检索抛错时降级为空上下文，对话照常进行", async () => {
      mockRetrieveHighlights.mockRejectedValue(new Error('检索炸了'))
      const result = await builder.build(ctxWithBook())
      expect(result.content).toBe('')
    })

    // ========================================================================
    // 引用来源（2026-09-16 新增）
    // metadata.previews 只有 title/snippet/score，是给「调取知识库」面板看过程用的；
    // 消息气泡的「引用来源」需要能定位回具体划线的真实片段。
    // 此前这一层把 highlightId / bookId / relevanceScore 丢掉了，
    // 导致 chat_messages.sources 永远为空。
    // ========================================================================
    it("metadata.sources 带齐 highlightId / bookId / 相关度", async () => {
      mockRetrieveHighlights.mockResolvedValue([
        {
          highlightId: 'hl_1',
          bookId: 'b1',
          content: '原文片段',
          bookTitle: '书名',
          chapterTitle: '第1章',
          relevanceScore: 0.83,
        },
      ])
      const result = await builder.build(ctxWithBook())
      expect(result.metadata?.sources).toEqual([
        {
          highlightId: 'hl_1',
          bookId: 'b1',
          bookTitle: '书名',
          chapterTitle: '第1章',
          content: '原文片段',
          relevanceScore: 0.83,
        },
      ])
    })

    it("缺少 highlightId 的命中项被剔除（不能进「引用来源」）", async () => {
      mockRetrieveHighlights.mockResolvedValue([
        { content: '来源不明', bookTitle: '书', relevanceScore: 0.5 },
        { highlightId: 'hl_ok', bookId: 'b1', content: '有身份', bookTitle: '书', relevanceScore: 0.6 },
      ])
      const result = await builder.build(ctxWithBook())
      expect(result.metadata?.sources).toHaveLength(1)
      expect(result.metadata?.sources?.[0].highlightId).toBe('hl_ok')
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

  it('shouldBuild：无 bookId 也返回 true（跨全部检索）', () => {
    expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(true)
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
    const result = builder.build(ctxWithBook({ userMessage: '费曼方法怎么用' }))
    expect(result.content).toContain('费曼方法')
    expect(result.content).toContain('Feynman')
    expect(result.content).toContain('触发场景')
    expect(result.content).toContain('选概念')
    expect(result.content).toContain('掌握度')
    expect(result.metadata?.method).toBe('relevance')
    expect(result.metadata?.itemCount).toBeGreaterThanOrEqual(1)
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
    const result = builder.build(ctxWithBook({ userMessage: '坏步骤方法怎么用' }))
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

  it('shouldBuild：无 bookId 也返回 true（跨全部检索）', () => {
    expect(builder.shouldBuild(ctxWithBook({ bookId: undefined }))).toBe(true)
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
    expect(result.metadata?.method).toBe('keyword')
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

// ============================================================================
// 未关联书籍时的全局检索（2026-09-16 新增）
//
// 实测发现：从首页进入「AI 对话」时是没有选书的，而 book / knowledgeCard /
// methodology 三个构建器原来都要求 !!context.bookId —— 于是默认路径上
// 「调取知识库」只剩「相关记忆 + 用户画像」两路，934 条划线、90 张卡片
// 一条都进不了提示词（AI 只能回答「你提供的笔记里没有相关内容」）。
// 这几条钉住：没选书时也必须检索，且只注入真正命中的。
// ============================================================================
describe('未关联书籍时的全局检索（默认对话路径）', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    booksDb.create({ id: 'b2', title: '认知觉醒' } as never)
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('BookContextBuilder：不带 bookId 调检索，并把「来自全部书籍」写进上下文', async () => {
    mockRetrieveHighlights.mockResolvedValue([
      {
        highlightId: 'hl_9',
        bookId: 'b1',
        bookTitle: '被讨厌的勇气',
        chapterTitle: '第二夜',
        content: '一切烦恼都来自人际关系',
        relevanceScore: 12.3,
      },
    ])
    const result = await new BookContextBuilder().build(
      ctxWithBook({ bookId: undefined, userMessage: '作者怎么看人际关系' }),
    )
    expect(mockRetrieveHighlights).toHaveBeenCalledWith('作者怎么看人际关系', { limit: 5 })
    expect(result.content).toContain('一切烦恼都来自人际关系')
    expect(result.content).toContain('[第二夜]')
    expect(result.content).toContain('全部书籍')
    expect(result.metadata?.itemCount).toBe(1)
  })

  it('KnowledgeCardContextBuilder：没选书时跨全部卡片检索，只带相关那张', () => {
    knowledgeCardsDb.create({
      id: 'kc1',
      book_id: 'b1',
      type: 'concept',
      title: '课题分离',
      content: '把别人的课题还给别人',
      interpretation: '人际关系的烦恼来自干涉他人的课题',
      tags: '[]',
    } as never)
    knowledgeCardsDb.create({
      id: 'kc2',
      book_id: 'b2',
      type: 'concept',
      title: '舒适区边缘',
      content: '在拉伸区练习',
      tags: '[]',
    } as never)

    const result = new KnowledgeCardContextBuilder().build(
      ctxWithBook({ bookId: undefined, userMessage: '人际关系里的课题分离是什么意思' }),
    )
    expect(result.content).toContain('课题分离')
    expect(result.content).not.toContain('舒适区边缘')
    expect(result.metadata?.itemCount).toBe(1)
  })

  it('KnowledgeCardContextBuilder：完全不相关时不注入（原来是按库顺序硬塞 10 张）', () => {
    knowledgeCardsDb.create({
      id: 'kc1',
      book_id: 'b1',
      type: 'concept',
      title: '课题分离',
      content: '把别人的课题还给别人',
      tags: '[]',
    } as never)
    const result = new KnowledgeCardContextBuilder().build(
      ctxWithBook({ bookId: undefined, userMessage: '今天天气怎么样' }),
    )
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
  })

  it('MethodologyContextBuilder：没选书时跨全部方法论检索', () => {
    methodologiesDb.create({
      id: 'm1',
      book_id: 'b1',
      name: '费曼学习法',
      description: '用教别人的方式检验自己',
      steps: ['选概念', '讲给外行'],
      mastery_level: 20,
    })
    const result = new MethodologyContextBuilder().build(
      ctxWithBook({ bookId: undefined, userMessage: '费曼学习法怎么用' }),
    )
    expect(result.content).toContain('费曼学习法')
    expect(result.metadata?.itemCount).toBe(1)
  })
})


describe('BookContextBuilder 的摘要层（层级摘要 L1/L2 注入）', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    booksDb.create({ id: 'b1', title: '被讨厌的勇气' } as never)
    chapterSummariesDb.upsertBatch('b1', [
      { chapterTitle: '第一夜 此刻开始改变', summary: '心理创伤并不存在，人是为了不改变而选择不改变。', sourceCount: 12 },
      { chapterTitle: '第二夜 一切烦恼都来自人际关系', summary: '所有的烦恼都来自于人际关系，自卑感是自己主观赋予的。', sourceCount: 20 },
    ])
    bookSummariesDb.create('b1', '全书讲一个人如何从人际关系的束缚里获得自由。', '["自由就是被别人讨厌"]')
    mockRetrieveHighlights.mockResolvedValue([])
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('选了书就带上全书摘要，并标明它是 AI 概括而不是原文', async () => {
    const result = await new BookContextBuilder().build(ctxWithBook({ userMessage: '这本书到底在讲什么' }))
    expect(result.content).toContain('AI 依据你的划线概括')
    expect(result.content).toContain('【全书】全书讲一个人如何从人际关系的束缚里获得自由。')
  })

  it('章节摘要按相关度挑，不相关的章节不进来', async () => {
    const result = await new BookContextBuilder().build(ctxWithBook({ userMessage: '自卑感是从哪来的' }))
    expect(result.content).toContain('【第二夜 一切烦恼都来自人际关系】')
    expect(result.content).not.toContain('【第一夜 此刻开始改变】')
  })

  it('没选书时不带摘要层（摘要是按书存的，跨书拼没有意义）', async () => {
    const result = await new BookContextBuilder().build(ctxWithBook({ bookId: undefined }))
    expect(result.content).not.toContain('书籍摘要')
  })

  it('一条划线都没检索到时，摘要层仍能独立支撑这一轮上下文', async () => {
    const result = await new BookContextBuilder().build(ctxWithBook({ userMessage: '人际关系' }))
    expect(result.content).toContain('书籍摘要')
    expect(result.metadata?.itemCount).toBeGreaterThan(0)
  })
})
