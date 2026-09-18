// 知行读书 — AI service 函数测试（Phase 8 T2，2026-07-22）
//
// 覆盖：generateChapterSummary / generateBookSummary（callAI 载体）/
//       extractMethodologies / analyzeBookArchitecture / distillKnowledgeCards /
//       generateCardInterpretation / generateCardApplication / generateSkill /
//       translateArticle /
//       setAIConfig / getAIConfig / initFromSettings
//
// 策略：
//   - vi.mock fetchWithTimeout + fetchWithRetry，避免真实网络调用
//   - vi.mock database.tokenUsageDb，避免真实 DB 写入（recordTokenUsage 内部已 try/catch，
//     但 mock 后可断言调用次数）
//   - 每个测试用不同 bookTitle / highlights 内容避免 responseCache 命中
//     （callAI 对不传 opts 的调用会缓存 10 分钟，跨测试会污染）
//   - 配置走 setAIConfig（openai provider），callAI 走 callOpenAI 分支
//   - extractAndParseJSON / repairJSON 由 ai-service-json.test.ts 直接覆盖，此处不再重复

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============ Mock：http-client，避免真实网络调用 ============
// 保留 HttpAbortError / RETRY_CONFIGS 等其他 export，只覆盖 fetchWithTimeout / fetchWithRetry
vi.mock('../electron/http-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/http-client')>()
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    fetchWithRetry: vi.fn(),
  }
})

// ============ Mock：database，避免真实 DB 写入 ============
// ai-service.ts 只 import tokenUsageDb，mock 后 recordTokenUsage 不会真正写库
vi.mock('../electron/database', () => ({
  tokenUsageDb: {
    create: vi.fn(),
  },
}))

import {
  setAIConfig,
  getAIConfig,
  initFromSettings,
  generateChapterSummary,
  generateBookSummary,
  extractMethodologies,
  distillKnowledgeCards,
  generateCardInterpretation,
  generateCardApplication,
  generateSkill,
  translateArticle,
  testConnection,
} from '../electron/ai-service'
import { fetchWithTimeout, fetchWithRetry, HttpAbortError } from '../electron/http-client'
import { tokenUsageDb } from '../electron/database'

const mockedFetchWithTimeout = vi.mocked(fetchWithTimeout)
const mockedFetchWithRetry = vi.mocked(fetchWithRetry)
const mockedTokenUsageCreate = vi.mocked(tokenUsageDb.create)

// ============ 辅助函数 ============

/** 构造 OpenAI 格式的 mock Response（callOpenAI 解析 choices[0].message.content + usage） */
function createOpenAIResponse(
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number } = { prompt_tokens: 10, completion_tokens: 5 }
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: null,
    json: async () => ({
      choices: [{ message: { content, role: 'assistant' }, finish_reason: 'stop' }],
      usage,
    }),
    text: async () => '',
  } as unknown as Response
}

function setOpenAIConfig(): void {
  setAIConfig({
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    baseUrl: 'https://test.openai.example/v1',
    maxTokens: 100,
    temperature: 0.5,
  })
}

beforeEach(() => {
  // 重置 mock 调用记录和实现
  mockedFetchWithTimeout.mockReset()
  mockedFetchWithRetry.mockReset()
  mockedTokenUsageCreate.mockReset()
  // 默认配置为 OpenAI
  setOpenAIConfig()
})

// ============ 测试用例 ============

describe('配置管理', () => {
  it('1. setAIConfig → getAIConfig 往返一致', () => {
    const cfg = { provider: 'anthropic' as const, apiKey: 'sk-ant', model: 'claude-3' }
    setAIConfig(cfg)
    expect(getAIConfig()).toBe(cfg)
  })

  it('2. initFromSettings 有 llmKey 时初始化配置', () => {
    initFromSettings({
      llmKey: 'sk-init',
      aiProvider: 'openai',
      llmEndpoint: 'https://api.openai.com/v1',
      llmModel: 'gpt-4o',
    })
    const cfg = getAIConfig()
    expect(cfg).toBeTruthy()
    expect(cfg?.apiKey).toBe('sk-init')
    expect(cfg?.provider).toBe('openai')
    expect(cfg?.baseUrl).toBe('https://api.openai.com/v1')
    expect(cfg?.model).toBe('gpt-4o')
    expect(cfg?.maxTokens).toBe(2000)
    expect(cfg?.temperature).toBe(0.7)
  })

  it('3. initFromSettings 无 llmKey 时保持原配置不变', () => {
    setAIConfig({ provider: 'openai', apiKey: 'original-key', model: 'gpt-4o' })
    initFromSettings({})
    expect(getAIConfig()?.apiKey).toBe('original-key')
  })
})

describe('callOpenAI 错误处理', () => {
  it('4a. OpenAI 返回空 choices 数组时抛错', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      text: async () => '',
    } as unknown as Response)

    await expect(
      generateChapterSummary('test-book-callai-empty', '第一章', '一条划线')
    ).rejects.toThrow('Invalid response from OpenAI API: no choices returned')
  })

  it('4b. OpenAI 返回 choices 但 message 为空时抛错', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({
        choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    } as unknown as Response)

    await expect(
      generateChapterSummary('test-book-callai-no-message', '第一章', '一条划线')
    ).rejects.toThrow('Invalid response from OpenAI API: no choices returned')
  })
})

describe('callAnthropic 基本路径', () => {
  it('13a. Anthropic provider 返回有效响应被正确解析', async () => {
    setAIConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://test.anthropic.example/v1',
      maxTokens: 100,
      temperature: 0.5,
    })

    const summaryPayload = JSON.stringify({
      summary: 'Anthropic 摘要',
      keyPoints: ['要点 A', '要点 B'],
    })

    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({
        content: [{ type: 'text', text: summaryPayload }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: 'end_turn',
      }),
      text: async () => '',
    } as unknown as Response)

    const result = await generateBookSummary(
      'test-book-anthropic-summary',
      '[第一章] 章节摘要'
    )

    expect(result.summary).toBe('Anthropic 摘要')
    expect(result.keyPoints).toEqual(['要点 A', '要点 B'])
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateBookSummary')
  })

  it('13b. Anthropic 返回空 content 数组时抛错', async () => {
    setAIConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://test.anthropic.example/v1',
      maxTokens: 100,
      temperature: 0.5,
    })

    mockedFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({
        content: [],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      text: async () => '',
    } as unknown as Response)

    await expect(
      generateBookSummary('test-book-anthropic-empty', '[第一章] 章节摘要')
    ).rejects.toThrow('Invalid response from Anthropic API: no content returned')
  })
})

describe('extractMethodologies', () => {
  it('17. 正常返回方法论数组（含 steps / tags）', async () => {
    const methods = [
      {
        name: '方法1',
        nameEn: 'method-1',
        triggerScenario: '场景1',
        description: '描述1',
        steps: ['步骤1', '步骤2'],
        outputFormat: '格式1',
        examples: '示例1',
        tags: ['tag1'],
      },
      { name: '方法2' },
    ]
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(methods)))

    const result = await extractMethodologies(
      [{ content: 'highlight', chapterTitle: 'ch1', note: 'note' }],
      'test-book-methods-1'
    )

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('方法1')
    expect(result[0].nameEn).toBe('method-1')
    expect(result[0].steps).toEqual(['步骤1', '步骤2'])
    expect(result[0].tags).toEqual(['tag1'])
    expect(result[1].name).toBe('方法2')
    expect(result[1].steps).toBeUndefined()
  })

  it('18. >50 条 highlights 时截断到 50（只调一次 callAI）', async () => {
    const highlights = Array.from({ length: 60 }, (_, i) => ({ content: `h-${i}` }))
    mockedFetchWithRetry.mockResolvedValueOnce(
      createOpenAIResponse(JSON.stringify([{ name: 'method' }]))
    )

    const result = await extractMethodologies(highlights, 'test-book-truncate')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('method')
    // 验证只调用了一次 fetchWithRetry
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1)
    // 验证 messages 中只包含前 50 条 highlights（highlightTexts 变量）
    const body = JSON.parse(mockedFetchWithRetry.mock.calls[0][1].body as string)
    const userContent: string = body.messages[1].content
    expect(userContent).toContain('h-0')
    expect(userContent).toContain('h-49')
    expect(userContent).not.toContain('h-50')
    expect(userContent).not.toContain('h-59')
  })

  it('19. 空 highlights 抛错', async () => {
    await expect(extractMethodologies([], 'empty')).rejects.toThrow('No highlights')
  })

  it('20. fetch 失败时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Network failure'))

    await expect(
      extractMethodologies([{ content: 'highlight' }], 'test-book-methods-error')
    ).rejects.toThrow('Network failure')
  })
})


describe('distillKnowledgeCards', () => {
  it('22. 单批蒸馏正常返回卡片（highlights ≤ batchSize）', async () => {
    const cards = [
      { type: 'concept', title: '概念1', content: '内容1', interpretation: '解读', tags: ['t'] },
      { type: 'methodology', title: '方法', content: '内容' },
    ]
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(cards)))

    const onProgress = vi.fn()
    const result = await distillKnowledgeCards(
      [{ content: 'highlight' }],
      'test-book-distill-1',
      { onProgress }
    )

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('concept')
    expect(result[0].title).toBe('概念1')
    expect(result[0].interpretation).toBe('解读')
    expect(result[0].tags).toEqual(['t'])
    expect(result[1].type).toBe('methodology')
    // onProgress 至少被调用（fetch 阶段）
    expect(onProgress).toHaveBeenCalled()
    // feature 应为 'distillKnowledgeCards'
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('distillKnowledgeCards')
  })

  it('23. 多批蒸馏：highlights > batchSize 时分批调用 callAI', async () => {
    const highlights = [
      { content: 'h1' },
      { content: 'h2' },
      { content: 'h3' },
      { content: 'h4' },
    ]
    // batchSize=2，分 2 批
    mockedFetchWithRetry
      .mockResolvedValueOnce(
        createOpenAIResponse(JSON.stringify([{ type: 'concept', title: 'c1', content: 'content1' }]))
      )
      .mockResolvedValueOnce(
        createOpenAIResponse(JSON.stringify([{ type: 'quote', title: 'c2', content: 'content2' }]))
      )

    const onProgress = vi.fn()
    const result = await distillKnowledgeCards(highlights, 'test-book-distill-2', {
      batchSize: 2,
      onProgress,
    })

    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('c1')
    expect(result[1].title).toBe('c2')
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(2)
    // onProgress 应被调用多次（fetch + batch×2 + save）
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('24. 空 highlights 抛错', async () => {
    await expect(distillKnowledgeCards([], 'empty')).rejects.toThrow('No highlights')
  })

  it('25. AbortSignal 已 aborted 时抛 HttpAbortError', async () => {
    const highlights = [
      { content: 'h1' },
      { content: 'h2' },
      { content: 'h3' },
      { content: 'h4' },
    ]
    const controller = new AbortController()
    controller.abort()

    await expect(
      distillKnowledgeCards(highlights, 'test-book-abort', {
        batchSize: 2,
        signal: controller.signal,
      })
    ).rejects.toThrow('取消')
  })

  it('26. 无效 type 字段时回退为 concept', async () => {
    const cards = [
      { type: 'invalid-type', title: 't', content: 'c' },
      { type: 'methodology', title: 't2', content: 'c2' },
    ]
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(cards)))

    const result = await distillKnowledgeCards(
      [{ content: 'h' }],
      'test-book-distill-3'
    )

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('concept') // 无效 type 回退
    expect(result[1].type).toBe('methodology')
  })

  it('24. highlight 无 chapterTitle/note 时仍正常蒸馏', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(
      JSON.stringify([{ type: 'concept', title: 'c', content: 'c' }])
    ))

    const result = await distillKnowledgeCards(
      [{ content: 'highlight without chapter' }],
      'test-book-distill-no-chapter'
    )

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('c')
  })

  it('25. AI 返回非数组 JSON 时抛错', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('{"notAnArray": true}'))

    await expect(
      distillKnowledgeCards([{ content: 'highlight' }], 'test-book-distill-not-array')
    ).rejects.toThrow('AI响应中未找到有效的JSON格式')
  })

  it('26. AI 返回空卡片数组时返回空数组', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('[]'))

    const result = await distillKnowledgeCards(
      [{ content: 'highlight' }],
      'test-book-distill-empty'
    )

    expect(result).toHaveLength(0)
  })

  it('27. fetch 失败时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Network failure'))

    await expect(
      distillKnowledgeCards([{ content: 'highlight' }], 'test-book-distill-error')
    ).rejects.toThrow('Network failure')
  })

  // ==========================================================================
  // 卡片溯源（2026-09-16 新增）
  // 背景：提示词给每条笔记编了号，却没让 AI 回答"这张卡来自第几条"，
  //       于是 source_highlight_id 只能写死 null —— 实测 90 张卡片来源全空。
  // ==========================================================================
  describe('sourceHighlightId 溯源', () => {
    it('单批：AI 给的 sourceIndex 换算成对应的划线 id', async () => {
      mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
        { type: 'concept', title: 'c1', content: 'x', sourceIndex: 2 },
      ])))

      const result = await distillKnowledgeCards(
        [{ id: 'hl_1', content: 'a' }, { id: 'hl_2', content: 'b' }],
        'test-book-source-single',
      )

      expect(result[0].sourceIndex).toBe(2)
      expect(result[0].sourceHighlightId).toBe('hl_2')
    })

    it('多批：第二张卡的序号是**批内**编号，必须换算成全局正确的那一条', async () => {
      // batchSize=2 → 批1 = [h1,h2]，批2 = [h3,h4]
      mockedFetchWithRetry
        .mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
          { type: 'concept', title: 'c1', content: 'x', sourceIndex: 1 },
        ])))
        .mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
          { type: 'concept', title: 'c2', content: 'y', sourceIndex: 2 },
        ])))

      const result = await distillKnowledgeCards(
        [
          { id: 'hl_1', content: 'a' },
          { id: 'hl_2', content: 'b' },
          { id: 'hl_3', content: 'c' },
          { id: 'hl_4', content: 'd' },
        ],
        'test-book-source-batch',
        { batchSize: 2 },
      )

      expect(mockedFetchWithRetry).toHaveBeenCalledTimes(2)
      expect(result[0].sourceHighlightId).toBe('hl_1')
      // 关键：批2 的 [2] 是 hl_4，不是 hl_2
      expect(result[1].sourceHighlightId).toBe('hl_4')
    })

    it('AI 没给 sourceIndex → null 语义，**不猜**', async () => {
      mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
        { type: 'concept', title: 'c1', content: 'x' },
      ])))

      const result = await distillKnowledgeCards(
        [{ id: 'hl_1', content: 'a' }],
        'test-book-source-missing',
      )

      expect(result[0].sourceHighlightId).toBeUndefined()
    })

    it('sourceIndex 越界 → undefined，不指向任何划线', async () => {
      mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
        { type: 'concept', title: 'c1', content: 'x', sourceIndex: 99 },
        { type: 'concept', title: 'c2', content: 'y', sourceIndex: 0 },
        { type: 'concept', title: 'c3', content: 'z', sourceIndex: 'abc' },
      ])))

      const result = await distillKnowledgeCards(
        [{ id: 'hl_1', content: 'a' }],
        'test-book-source-out-of-range',
      )

      expect(result.every((c) => c.sourceHighlightId === undefined)).toBe(true)
    })

    it('划线本身没有 id 时（老数据）安全返回 undefined', async () => {
      mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
        { type: 'concept', title: 'c1', content: 'x', sourceIndex: 1 },
      ])))

      const result = await distillKnowledgeCards(
        [{ content: 'a' }],
        'test-book-source-no-id',
      )

      expect(result[0].sourceHighlightId).toBeUndefined()
    })
  })
})

describe('extractMethodologies — 来源划线', () => {
  it('sourceIndexes 换算成 sourceHighlightIds', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
      { name: '方法A', steps: ['1'], sourceIndexes: [3, 1, 99] },
    ])))

    const result = await extractMethodologies(
      [
        { id: 'hl_1', content: 'a' },
        { id: 'hl_2', content: 'b' },
        { id: 'hl_3', content: 'c' },
      ],
      'test-book-meth-source',
    )

    // 越界的 99 被丢弃，保留有效且有序的两条
    expect(result[0].sourceIndexes).toEqual([3, 1, 99])
    expect(result[0].sourceHighlightIds).toEqual(['hl_3', 'hl_1'])
  })

  it('AI 没给来源时为空数组，不猜', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify([
      { name: '方法B', steps: ['1'] },
    ])))

    const result = await extractMethodologies(
      [{ id: 'hl_1', content: 'a' }],
      'test-book-meth-no-source',
    )

    expect(result[0].sourceHighlightIds).toEqual([])
  })
})

describe('generateCardInterpretation', () => {
  it('27. 正常返回解读内容（trim 处理）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('  这是解读  '))

    const result = await generateCardInterpretation('书名', '卡片标题', '卡片内容', 'concept')

    expect(result).toBe('这是解读')
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateCardInterpretation')
  })

  it('28. 网络错误时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Interpretation fail'))

    await expect(
      generateCardInterpretation('书名', '标题', '内容', 'methodology')
    ).rejects.toThrow('Interpretation fail')
  })
})

describe('generateCardApplication', () => {
  it('29. 正常返回应用建议（trim 处理）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('  应用建议  '))

    const result = await generateCardApplication('书名', '卡片标题', '卡片内容', 'quote')

    expect(result).toBe('应用建议')
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateCardApplication')
  })

  it('30. 网络错误时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Application fail'))

    await expect(
      generateCardApplication('书名', '标题', '内容', 'concept')
    ).rejects.toThrow('Application fail')
  })
})

describe('generateSkill', () => {
  it('31. 正常返回技能内容（nameEn 存在时直接使用）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('skill content'))

    const result = await generateSkill({
      name: '深度学习',
      nameEn: 'deep-learning',
      description: 'desc',
      steps: ['step1', 'step2'],
      bookTitle: '书名',
    })

    expect(result).toBe('skill content')
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateSkill')
  })

  it('32. nameEn 缺失时不抛错（走 name 转换 fallback）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('skill no nameEn'))

    const result = await generateSkill({ name: '中文名' })

    expect(result).toBe('skill no nameEn')
  })
})

describe('translateArticle', () => {
  it('35. 正常分段翻译：标题 + 多段落', async () => {
    mockedFetchWithRetry
      .mockResolvedValueOnce(createOpenAIResponse('标题翻译')) // 标题
      .mockResolvedValueOnce(createOpenAIResponse('段落1翻译')) // 段落1
      .mockResolvedValueOnce(createOpenAIResponse('段落2翻译')) // 段落2

    const result = await translateArticle('Article-35', 'Paragraph 1\n\nParagraph 2')

    expect(result.title_zh).toBe('标题翻译')
    expect(result.content_zh).toBe('段落1翻译\n\n段落2翻译')
    // summary_zh = 第一段前 100 字符 + '...'
    expect(result.summary_zh).toBe('段落1翻译...')
  })

  it('36. 空 content 时只翻译标题（content_zh + summary_zh 均为空字符串）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('标题'))

    const result = await translateArticle('Article-36', '')

    expect(result.title_zh).toBe('标题')
    expect(result.content_zh).toBe('')
    // 修复后（Phase 11 T1）：原 ai-service.ts:1433 运算符优先级 bug 已修
    //   修复前: `contentParagraphs[0]?.slice(0, 100) + '...' || ''` → 'undefined...'
    //   修复后: `contentParagraphs[0] ? contentParagraphs[0].slice(0,100) + '...' : ''` → ''
    expect(result.summary_zh).toBe('')
  })

  it('37. 标题与正文都返回空 → 必须抛错，不能默默写空字符串入库', async () => {
    // 线上故障回归：deepseek-flash 默认开启思考，把 200/1000 的输出预算全烧在
    // reasoning 上，正文返回空字符串。原实现不校验，把空串写进 articles 表并
    // 当成功上报，前端因此永远显示「点击翻译」且不报错。
    mockedFetchWithRetry
      .mockResolvedValueOnce(createOpenAIResponse('')) // 标题空
      .mockResolvedValueOnce(createOpenAIResponse('')) // 段落空

    await expect(translateArticle('Article-37', 'Paragraph')).rejects.toThrow(/翻译返回空内容/)
  })

  it('38. 翻译请求显式关闭深度思考（reasoning_effort=none）', async () => {
    mockedFetchWithRetry
      .mockResolvedValueOnce(createOpenAIResponse('标题'))
      .mockResolvedValueOnce(createOpenAIResponse('段落'))

    await translateArticle('Article-38', 'Paragraph')

    const bodies = mockedFetchWithRetry.mock.calls.map((c) => JSON.parse(String((c[1] as { body?: string })?.body ?? '{}')))
    expect(bodies.length).toBeGreaterThan(0)
    // 机械任务不应触发思考，否则小预算下正文会被 reasoning 挤空
    for (const b of bodies) {
      expect(b.reasoning_effort).toBe('none')
    }
  })
})

describe('callAI 错误处理', () => {
  it('39. unsupported provider 抛错', async () => {
    setAIConfig({
      provider: 'unsupported',
      apiKey: 'sk-test',
      model: 'unknown',
      baseUrl: 'https://example.com',
    })

    await expect(
      generateChapterSummary('test-book-unsupported', '第一章', '一条划线')
    ).rejects.toThrow('Unsupported AI provider: unsupported')
  })

  it('45. testConnection fetch 抛出非 Error 对象时返回字符串化错误', async () => {
    setAIConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.com',
    })

    mockedFetchWithTimeout.mockRejectedValueOnce('string error')

    const result = await testConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('连接失败')
    expect(result.message).toContain('string error')
  })

  it('46. provider 为空字符串时 fallback 到 unknown 并抛错', async () => {
    setAIConfig({
      provider: '' as AIProvider,
      apiKey: 'sk-test',
      model: 'unknown',
      baseUrl: 'https://example.com',
    })

    await expect(
      generateChapterSummary('test-book-empty-provider', '第一章', '一条划线')
    ).rejects.toThrow('Unsupported AI provider: ')
  })

  it('47. temperature/maxTokens/model/baseUrl 缺失时使用 fallback', async () => {
    setAIConfig({
      provider: 'openai',
      apiKey: 'sk-test',
    })

    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('本章讲了心理创伤并不存在。'))

    const result = await generateChapterSummary('test-book-fallback', '第一章', '一条划线')

    expect(result).toBe('本章讲了心理创伤并不存在。')
    const body = JSON.parse(mockedFetchWithRetry.mock.calls[0][1].body as string)
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(4000)
    expect(body.model).toBe('gpt-4o-mini')
    expect(mockedFetchWithRetry.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('48. testConnection HTTP 错误时返回错误消息', async () => {
    setAIConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.com',
    })

    mockedFetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    } as unknown as Response)

    const result = await testConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('API错误')
    expect(result.message).toContain('401')
    expect(result.message).toContain('Invalid API key')
  })

  it('49. 相同输入调用两次时第二次命中缓存', async () => {
    setOpenAIConfig()

    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('cached response'))

    const result1 = await generateChapterSummary('book', '第一章', '一条划线')
    expect(result1).toBe('cached response')
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1)

    const result2 = await generateChapterSummary('book', '第一章', '一条划线')
    expect(result2).toBe('cached response')
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1)
  })
})


