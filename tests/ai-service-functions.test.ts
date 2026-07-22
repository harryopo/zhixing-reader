// 知行读书 — AI service 函数测试（Phase 8 T2，2026-07-22）
//
// 覆盖：generateCards / generateSummary / chatWithContext / explainHighlight /
//       extractMethodologies / analyzeBookArchitecture / distillKnowledgeCards /
//       generateCardInterpretation / generateCardApplication / generateSkill /
//       generateSkillBatch / translateArticle / cancelActiveStream /
//       setAIConfig / getAIConfig / initFromSettings
//
// 策略：
//   - vi.mock fetchWithTimeout + fetchWithRetry，避免真实网络调用
//   - vi.mock database.tokenUsageDb，避免真实 DB 写入（recordTokenUsage 内部已 try/catch，
//     但 mock 后可断言调用次数）
//   - 每个测试用不同 bookTitle / highlights 内容避免 responseCache 命中
//     （callAI 对不传 opts 的调用会缓存 10 分钟，跨测试会污染）
//   - 配置走 setAIConfig（openai provider），callAI 走 callOpenAI 分支
//   - extractAndParseJSON / repairJSON 是内部函数，通过 generateCards 间接测试

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
  generateCards,
  generateSummary,
  chatWithContext,
  explainHighlight,
  extractMethodologies,
  analyzeBookArchitecture,
  distillKnowledgeCards,
  generateCardInterpretation,
  generateCardApplication,
  generateSkill,
  generateSkillBatch,
  translateArticle,
  cancelActiveStream,
  streamChat,
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
  // 清空 active stream controller（避免上一个 streamChat 测试遗留）
  cancelActiveStream()
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
      generateCards([{ content: 'highlight' }], 'test-book-callai-empty')
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
      generateCards([{ content: 'highlight' }], 'test-book-callai-no-message')
    ).rejects.toThrow('Invalid response from OpenAI API: no choices returned')
  })
})

describe('generateCards', () => {
  it('5. 正常 JSON 数组返回有效卡片', async () => {
    const cards = [
      { front: '问题1', back: '答案1', tags: ['tag1', 'tag2'] },
      { front: '问题2', back: '答案2', tags: [] },
    ]
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(cards)))

    const result = await generateCards(
      [{ content: 'highlight A', note: 'note A' }],
      'test-book-cards-1'
    )

    expect(result).toHaveLength(2)
    expect(result[0].front).toBe('问题1')
    expect(result[0].back).toBe('答案1')
    expect(result[0].tags).toEqual(['tag1', 'tag2'])
    expect(result[1].front).toBe('问题2')
    expect(result[1].tags).toEqual([])
    // 验证 recordTokenUsage 被调用（usage 存在时）
    expect(mockedTokenUsageCreate).toHaveBeenCalledTimes(1)
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateCards')
  })

  it('5. markdown 代码块包裹的 JSON 能正确解析（extractAndParseJSON 路径）', async () => {
    const cards = [{ front: 'Q', back: 'A' }]
    const content = '```json\n' + JSON.stringify(cards) + '\n```'
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(content))

    const result = await generateCards(
      [{ content: 'highlight markdown' }],
      'test-book-cards-2'
    )

    expect(result).toHaveLength(1)
    expect(result[0].front).toBe('Q')
    expect(result[0].back).toBe('A')
  })

  it('6. 无效卡片被过滤（缺 front / back / null）', async () => {
    const cards = [
      { front: 'valid', back: 'valid-back' },
      { front: 'no-back' }, // 缺 back
      { back: 'no-front' }, // 缺 front
      null,
      { front: 123, back: 'wrong-type' }, // front 非 string
    ]
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(cards)))

    const result = await generateCards(
      [{ content: 'mixed cards' }],
      'test-book-cards-3'
    )

    expect(result).toHaveLength(1)
    expect(result[0].front).toBe('valid')
  })

  it('7. 空 highlights 抛错', async () => {
    await expect(generateCards([], 'empty-book')).rejects.toThrow('No highlights')
    expect(mockedFetchWithRetry).not.toHaveBeenCalled()
  })

  it('8. AI 返回非数组 JSON 时抛错（extractAndParseJSON 找不到 [ ]）', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(
      createOpenAIResponse('{"not": "array"}')
    )

    await expect(
      generateCards([{ content: 'not array' }], 'test-book-cards-4')
    ).rejects.toThrow()
  })

  it('9. 尾随逗号的 JSON 能被 repairJSON 修复后解析', async () => {
    // 尾随逗号 → JSON.parse 失败 → repairJSON 删除 ",}" / ",]" 前的逗号
    const malformedJson = '[{"front":"Q","back":"A",},]'
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(malformedJson))

    const result = await generateCards(
      [{ content: 'repair test' }],
      'test-book-cards-5'
    )

    expect(result).toHaveLength(1)
    expect(result[0].front).toBe('Q')
    expect(result[0].back).toBe('A')
  })
})

describe('generateSummary', () => {
  it('10. 正常返回 summary + keyPoints', async () => {
    const summary = {
      summary: '这是一本好书',
      keyPoints: ['要点1', '要点2', '要点3'],
    }
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(summary)))

    const result = await generateSummary(
      [{ content: 'highlight', chapterTitle: 'ch1' }],
      'test-book-summary-1'
    )

    expect(result.summary).toBe('这是一本好书')
    expect(result.keyPoints).toEqual(['要点1', '要点2', '要点3'])
    expect(mockedTokenUsageCreate).toHaveBeenCalledTimes(1)
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateSummary')
  })

  it('11. 空 highlights 抛错', async () => {
    await expect(generateSummary([], 'empty')).rejects.toThrow('No highlights')
  })

  it('12. AI 返回无效摘要格式（缺 summary 字段）抛错', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(
      createOpenAIResponse('{"noSummary": "missing field"}')
    )

    await expect(
      generateSummary([{ content: 'bad' }], 'test-book-summary-2')
    ).rejects.toThrow('摘要格式无效')
  })

  it('12b. keyPoints 包含空字符串/纯空白/非字符串时过滤掉', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(
      createOpenAIResponse(JSON.stringify({
        summary: '摘要内容',
        keyPoints: ['有效要点', '', '   ', 123, null, '另一个有效'],
      }))
    )

    const result = await generateSummary(
      [{ content: 'highlight' }],
      'test-book-summary-filter'
    )

    expect(result.summary).toBe('摘要内容')
    expect(result.keyPoints).toEqual(['有效要点', '另一个有效'])
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

    const result = await generateSummary(
      [{ content: 'highlight' }],
      'test-book-anthropic-summary'
    )

    expect(result.summary).toBe('Anthropic 摘要')
    expect(result.keyPoints).toEqual(['要点 A', '要点 B'])
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('generateSummary')
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
      generateSummary([{ content: 'highlight' }], 'test-book-anthropic-empty')
    ).rejects.toThrow('Invalid response from Anthropic API: no content returned')
  })
})

describe('chatWithContext', () => {
  it('13. 正常返回 AI 回答内容', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('这是AI回答'))

    const result = await chatWithContext('什么是深度学习', [
      { content: '上下文1', bookTitle: '书A' },
    ])

    expect(result).toBe('这是AI回答')
    // feature 应为 'chat'
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('chat')
  })

  it('14. 网络错误时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Network failure'))

    await expect(
      chatWithContext('问题', [{ content: 'ctx-different' }])
    ).rejects.toThrow('Network failure')
  })
})

describe('explainHighlight', () => {
  it('15. 正常返回解释内容', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('这是解释'))

    const result = await explainHighlight('划线内容', '书名1', '章节1')

    expect(result).toBe('这是解释')
    expect(mockedTokenUsageCreate.mock.calls[0][0].feature).toBe('explain')
  })

  it('16. 网络错误时抛错', async () => {
    mockedFetchWithRetry.mockRejectedValueOnce(new Error('Timeout'))

    await expect(explainHighlight('划线', '书名2')).rejects.toThrow('Timeout')
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
})

describe('analyzeBookArchitecture', () => {
  it('20. 正常返回书籍架构对象', async () => {
    const arch = {
      coreProposition: '核心命题',
      cognitiveFramework: { layer1: '认知层' },
      methodologyArchitecture: { methods: ['m1'] },
      knowledgeHierarchy: { level: 3 },
      targetAudience: '目标读者',
    }
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(JSON.stringify(arch)))

    const result = await analyzeBookArchitecture(
      [{ content: 'highlight', note: 'note', chapterTitle: 'ch' }],
      'test-book-arch-1'
    )

    expect(result.coreProposition).toBe('核心命题')
    expect(result.targetAudience).toBe('目标读者')
    expect(result.cognitiveFramework).toEqual({ layer1: '认知层' })
    expect(result.methodologyArchitecture).toEqual({ methods: ['m1'] })
    expect(result.knowledgeHierarchy).toEqual({ level: 3 })
  })

  it('21. 空 highlights 抛错', async () => {
    await expect(analyzeBookArchitecture([], 'empty')).rejects.toThrow('No highlights')
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

describe('generateSkillBatch', () => {
  it('33. 正常批量生成多个技能', async () => {
    mockedFetchWithRetry
      .mockResolvedValueOnce(createOpenAIResponse('skill1'))
      .mockResolvedValueOnce(createOpenAIResponse('skill2'))

    const result = await generateSkillBatch([
      { name: '方法-A' },
      { name: '方法-B' },
    ])

    expect(Object.keys(result)).toHaveLength(2)
    expect(result['方法-A']).toBe('skill1')
    expect(result['方法-B']).toBe('skill2')
  })

  it('34. 单个技能生成失败不影响其他（错误被捕获，结果中缺该 key）', async () => {
    mockedFetchWithRetry
      .mockRejectedValueOnce(new Error('generate fail')) // 第一个失败
      .mockResolvedValueOnce(createOpenAIResponse('skill2')) // 第二个成功

    const result = await generateSkillBatch([
      { name: '失败的方法' },
      { name: '成功的方法' },
    ])

    expect(result['成功的方法']).toBe('skill2')
    expect(result['失败的方法']).toBeUndefined()
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
})

describe('cancelActiveStream', () => {
  it('37. 无 active stream 时返回 false', () => {
    cancelActiveStream() // 先清空
    expect(cancelActiveStream()).toBe(false)
  })

  it('38. 有 active stream 时返回 true 并清空', async () => {
    // 用 pending Promise 让 streamChat 进入但未完成，activeStreamController 已设置
    let rejectFetch: ((err: Error) => void) | null = null
    const pendingFetch = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject
    })
    mockedFetchWithTimeout.mockImplementationOnce(() => pendingFetch as Promise<Response>)

    const streamPromise = streamChat(
      [{ role: 'user', content: 'hi' }],
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    // 第一次 cancel：应返回 true（有 active controller）
    expect(cancelActiveStream()).toBe(true)
    // 第二次 cancel：应返回 false（已清空）
    expect(cancelActiveStream()).toBe(false)

    // 让 fetch reject，使 streamChat 完成（避免悬挂 Promise）
    rejectFetch!(new HttpAbortError('请求被用户取消', 'cancelled', 300000))
    await streamPromise
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
      generateCards([{ content: 'highlight' }], 'test-book-unsupported')
    ).rejects.toThrow('Unsupported AI provider: unsupported')
  })
})

describe('repairJSON 边界', () => {
  it('40. repairJSON 完全无法修复时抛错', async () => {
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse('[{front: \'Q\'}]'))

    await expect(
      generateCards([{ content: 'highlight' }], 'test-book-repair-fail')
    ).rejects.toThrow('JSON解析失败')
  })

  it('41. repairJSON 处理字符串内换行/tab/反斜杠', async () => {
    const content = '[{ "front": "Q\nA", "back": "B\tC" }]'
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(content))

    const result = await generateCards(
      [{ content: 'highlight' }],
      'test-book-repair-special'
    )

    expect(result).toHaveLength(1)
    expect(result[0].front).toBe('Q\nA')
  })

  it('42. repairJSON 补全缺失的方括号/花括号', async () => {
    const content = '[{ "front": "Q", "back": "A" },]'
    mockedFetchWithRetry.mockResolvedValueOnce(createOpenAIResponse(content))

    const result = await generateCards(
      [{ content: 'highlight' }],
      'test-book-repair-brackets'
    )

    expect(result).toHaveLength(1)
    expect(result[0].front).toBe('Q')
  })
})
