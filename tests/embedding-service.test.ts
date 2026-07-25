// 知行读书 — embedding-service 单元测试（2026-07-25，过夜 Task #15）
//
// 覆盖 config / generateEmbedding / generateBatchEmbeddings / testConnection。
// embedding-service 是 RAG 向量化入口，此前 0 单测。mock fetchWithTimeout。

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.mock('../electron/http-client', () => ({
  fetchWithTimeout: mockFetch,
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 模块级 config 需 resetModules 才能干净
async function importFresh() {
  vi.resetModules()
  return await import('../electron/services/embedding-service')
}

function okEmbeddingResponse(embedding: number[], index = 0) {
  return {
    ok: true,
    json: async () => ({
      data: [{ embedding, index }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }),
    text: async () => '',
  }
}

describe('embedding-service — config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未配置时 generateEmbedding 抛错', async () => {
    const { generateEmbedding } = await importFresh()
    await expect(generateEmbedding('hi')).rejects.toThrow(/not configured/)
  })

  it('setEmbeddingConfig 后可生成', async () => {
    mockFetch.mockResolvedValue(
      okEmbeddingResponse(Array.from({ length: 1536 }, (_, i) => i * 0.001)),
    )
    const { setEmbeddingConfig, generateEmbedding } = await importFresh()
    setEmbeddingConfig({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' })
    const vec = await generateEmbedding('hello')
    expect(vec).toHaveLength(1536)
    expect(mockFetch).toHaveBeenCalled()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/embeddings')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body).input).toBe('hello')
  })

  it('initFromAIConfig 使用默认 openai baseUrl', async () => {
    mockFetch.mockResolvedValue(okEmbeddingResponse([0.1, 0.2]))
    const { initFromAIConfig, generateEmbedding } = await importFresh()
    initFromAIConfig({ apiKey: 'k' })
    await generateEmbedding('t')
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings')
  })
})

describe('embedding-service — generateEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('API 非 2xx 抛含 status 的错误', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
      json: async () => ({}),
    })
    const { setEmbeddingConfig, generateEmbedding } = await importFresh()
    setEmbeddingConfig({ apiKey: 'bad' })
    await expect(generateEmbedding('x')).rejects.toThrow(/401/)
  })

  it('空 data 数组抛 No embedding', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], usage: { prompt_tokens: 0, total_tokens: 0 } }),
      text: async () => '',
    })
    const { setEmbeddingConfig, generateEmbedding } = await importFresh()
    setEmbeddingConfig({ apiKey: 'k' })
    await expect(generateEmbedding('x')).rejects.toThrow(/No embedding/)
  })

  it('网络错误向上抛出', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const { setEmbeddingConfig, generateEmbedding } = await importFresh()
    setEmbeddingConfig({ apiKey: 'k' })
    await expect(generateEmbedding('x')).rejects.toThrow(/timeout/)
  })
})

describe('embedding-service — generateBatchEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按 index 排序返回', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
      text: async () => '',
    })
    const { setEmbeddingConfig, generateBatchEmbeddings } = await importFresh()
    setEmbeddingConfig({ apiKey: 'k' })
    const out = await generateBatchEmbeddings(['a', 'b'])
    expect(out).toEqual([[1], [2]])
  })

  it('超过 100 条分批请求', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      const n = body.input.length
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((_: string, i: number) => ({
            embedding: [i],
            index: i,
          })),
          usage: { prompt_tokens: n, total_tokens: n },
        }),
        text: async () => '',
      }
    })
    const { setEmbeddingConfig, generateBatchEmbeddings } = await importFresh()
    setEmbeddingConfig({ apiKey: 'k' })
    const texts = Array.from({ length: 101 }, (_, i) => `t${i}`)
    const out = await generateBatchEmbeddings(texts)
    expect(out).toHaveLength(101)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('未配置时抛错', async () => {
    const { generateBatchEmbeddings } = await importFresh()
    await expect(generateBatchEmbeddings(['a'])).rejects.toThrow(/not configured/)
  })
})

describe('embedding-service — testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('维度 1536 时 success', async () => {
    mockFetch.mockResolvedValue(
      okEmbeddingResponse(Array.from({ length: 1536 }, () => 0.1)),
    )
    const { testConnection } = await importFresh()
    const r = await testConnection('sk', 'https://api.example.com/v1')
    expect(r.success).toBe(true)
    expect(r.message).toMatch(/连接成功/)
  })

  it('维度不对时失败', async () => {
    mockFetch.mockResolvedValue(okEmbeddingResponse([0.1, 0.2]))
    const { testConnection } = await importFresh()
    const r = await testConnection('sk')
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/格式异常/)
  })

  it('HTTP 错误返回 success=false 不抛', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
      json: async () => ({}),
    })
    const { testConnection } = await importFresh()
    const r = await testConnection('sk')
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/500/)
  })

  it('网络异常返回 success=false', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const { testConnection } = await importFresh()
    const r = await testConnection('sk')
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/连接失败/)
  })
})
