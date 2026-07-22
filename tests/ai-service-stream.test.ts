// 知行读书 — AI service streamChat 流式测试（Phase 8 T1，2026-07-22）
//
// 覆盖：streamChat / streamOpenAI / streamAnthropic / abort / error / reasoning_content
// 策略：vi.mock fetchWithTimeout，返回构造的 ReadableStream SSE 响应，不调真实 API
//
// 14 个用例覆盖：
//   1. 配置与分支选择（8 用例：config 错误 / 三种 provider / cancel / abort / error）
//   2. streamOpenAI 流式解析（4 用例：SSE chunk / usage / reasoning_content / HTTP 错误）
//   3. streamAnthropic 流式解析（2 用例：content_block_delta / thinking_delta）

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============ Mock：fetchWithTimeout，避免真实网络调用 ============
// 保留 http-client 实际模块的其他 export（HttpAbortError / RETRY_CONFIGS 等），
// 只覆盖 fetchWithTimeout，让 streamChat 走 mock 响应分支。
vi.mock('../electron/http-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/http-client')>()
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  }
})

import { setAIConfig, streamChat, cancelActiveStream, testConnection } from '../electron/ai-service'
import { fetchWithTimeout, HttpAbortError } from '../electron/http-client'

const mockedFetchWithTimeout = vi.mocked(fetchWithTimeout)

// ============ 辅助函数：构造 SSE 响应 / 错误响应 / 配置 ============

/** 构造一个 mock Response，body 为包含 SSE 行的 ReadableStream */
function createSSEResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: stream,
    text: async () => '',
  } as unknown as Response
}

/** 构造一个 mock 错误 Response（response.ok = false） */
function createErrorResponse(status: number, errorText: string): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    body: null,
    text: async () => errorText,
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

function setAnthropicConfig(): void {
  setAIConfig({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-3-5-sonnet-20241022',
    baseUrl: 'https://test.anthropic.example/v1',
    maxTokens: 100,
    temperature: 0.5,
  })
}

function setCustomConfig(): void {
  setAIConfig({
    provider: 'custom',
    apiKey: 'sk-custom',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.example/v1',
    maxTokens: 100,
    temperature: 0.5,
  })
}

function setMinimalOpenAIConfig(): void {
  setAIConfig({
    provider: 'openai',
    apiKey: 'sk-test',
  })
}

const SAMPLE_MESSAGES = [{ role: 'user' as const, content: 'hi' }]

// ============ 测试用例 ============

describe('streamChat — 流式聊天测试', () => {
  beforeEach(() => {
    // 清理上一个测试遗留的 active controller
    cancelActiveStream()
    // 重置 mock 调用记录和实现
    mockedFetchWithTimeout.mockReset()
    // 默认配置为 OpenAI
    setOpenAIConfig()
  })

  describe('配置与分支选择', () => {
    it('1. 未配置 config 时调 onError，不调 onComplete / onChunk', async () => {
      // 通过 vi.resetModules 重新加载 ai-service，使内部 config 重置为 null
      vi.resetModules()
      const aiServiceFresh = await import('../electron/ai-service')

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await aiServiceFresh.streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(onError.mock.calls[0][0].message).toContain('not configured')
      expect(onComplete).not.toHaveBeenCalled()
      expect(onChunk).not.toHaveBeenCalled()
      // 未配置时不应发起 fetch
      expect(mockedFetchWithTimeout).not.toHaveBeenCalled()
    })

    it('2. provider=openai 走 streamOpenAI 分支（URL 含 /chat/completions）', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(mockedFetchWithTimeout).toHaveBeenCalledTimes(1)
      // OpenAI 端点路径
      expect(mockedFetchWithTimeout.mock.calls[0][0]).toContain('/chat/completions')
      // 请求头含 Bearer token
      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const headers = opts.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer sk-test')
      // chunk 与 complete 被调用
      expect(onChunk).toHaveBeenCalledWith('Hello')
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('3. provider=anthropic 走 streamAnthropic 分支（URL 含 /messages）', async () => {
      setAnthropicConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ])
      )

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(mockedFetchWithTimeout).toHaveBeenCalledTimes(1)
      expect(mockedFetchWithTimeout.mock.calls[0][0]).toContain('/messages')
      // Anthropic 请求头：x-api-key + anthropic-version
      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const headers = opts.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('sk-ant-test')
      expect(headers['anthropic-version']).toBe('2023-06-01')
      // chunk 与 complete
      expect(onChunk).toHaveBeenCalledWith('Hi')
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('4. provider=custom 走 streamOpenAI 分支（isOpenAICompatible）', async () => {
      setCustomConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Custom"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      // custom 走 OpenAI 兼容端点
      expect(mockedFetchWithTimeout.mock.calls[0][0]).toContain('/chat/completions')
      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const headers = opts.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer sk-custom')
      expect(onChunk).toHaveBeenCalledWith('Custom')
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('5. 中断旧 controller：cancelActiveStream 在有 active 时返回 true 并清空', async () => {
      // 用可控 pending Promise 让 streamChat 进入但未完成
      let rejectFetch: ((err: Error) => void) | null = null
      const pendingFetch = new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject
      })
      mockedFetchWithTimeout.mockImplementationOnce(() => pendingFetch as Promise<Response>)

      const streamPromise = streamChat(SAMPLE_MESSAGES, vi.fn(), vi.fn(), vi.fn())
      // streamChat 同步部分已执行：activeStreamController 已设置

      // 第一次 cancel：应返回 true（有 active controller）
      expect(cancelActiveStream()).toBe(true)
      // 第二次 cancel：应返回 false（已清空）
      expect(cancelActiveStream()).toBe(false)

      // 让 fetch reject，使 streamChat 完成（避免悬挂 Promise）
      rejectFetch!(new HttpAbortError('请求被用户取消', 'cancelled', 300000))
      // 等待 streamChat 完成（cancelled 错误会被 streamChat 内部捕获并调 onComplete）
      await streamPromise
    })

    it('6. 完成后清空 activeStreamController（cancelActiveStream 返回 false）', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse(['data: [DONE]\n\n'])
      )

      await streamChat(SAMPLE_MESSAGES, vi.fn(), vi.fn(), vi.fn())

      // 完成后 activeStreamController 应为 null
      expect(cancelActiveStream()).toBe(false)
    })

    it('7. abort 信号触发时调 onComplete（不调 onError）', async () => {
      // fetchWithTimeout 抛 HttpAbortError(cancelled)
      mockedFetchWithTimeout.mockRejectedValueOnce(
        new HttpAbortError('请求被用户取消', 'cancelled', 300000)
      )

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      // cancelled 错误应触发 onComplete(undefined)，不调 onError
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onComplete).toHaveBeenCalledWith(undefined)
      expect(onError).not.toHaveBeenCalled()
      expect(onChunk).not.toHaveBeenCalled()
    })

    it('8. 非 abort 异常调 onError（不调 onComplete）', async () => {
      mockedFetchWithTimeout.mockRejectedValueOnce(new Error('Network failure'))

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toBe('Network failure')
      expect(onComplete).not.toHaveBeenCalled()
      expect(onChunk).not.toHaveBeenCalled()
    })
  })

  describe('streamOpenAI 流式解析', () => {
    it('9. 成功流式：解析多个 SSE data: 行，依次调 onChunk', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const chunks: string[] = []
      const onChunk = (chunk: string) => chunks.push(chunk)
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(chunks).toEqual(['Hello', ' World', '!'])
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('10. usage 数据通过 SSE 返回并传给 onComplete', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const onComplete = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, vi.fn())

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onComplete).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 5,
      })
    })

    it('11. reasoning_content（DeepSeek R1）触发 onReasoningChunk', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"思考中..."}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"继续思考"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const reasoningChunks: string[] = []
      const onReasoningChunk = (chunk: string) => reasoningChunks.push(chunk)
      const contentChunks: string[] = []
      const onChunk = (chunk: string) => contentChunks.push(chunk)

      await streamChat(SAMPLE_MESSAGES, onChunk, vi.fn(), vi.fn(), {
        enableReasoning: true,
        onReasoningChunk,
      })

      // reasoning_content 被分派到 onReasoningChunk
      expect(reasoningChunks).toEqual(['思考中...', '继续思考'])
      // content 被分派到 onChunk
      expect(contentChunks).toEqual(['答案'])
    })

    it('12. HTTP 错误（4xx/5xx）调 onError 并包含状态码与错误文本', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createErrorResponse(429, 'Rate limit exceeded')
      )

      const onError = vi.fn()
      const onComplete = vi.fn()
      const onChunk = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toContain('429')
      expect(onError.mock.calls[0][0].message).toContain('Rate limit exceeded')
      expect(onError.mock.calls[0][0].message).toContain('OpenAI API error')
      expect(onComplete).not.toHaveBeenCalled()
      expect(onChunk).not.toHaveBeenCalled()
    })
  })

  describe('streamAnthropic 流式解析', () => {
    it('13. 成功流式：解析 content_block_delta，依次调 onChunk', async () => {
      setAnthropicConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ])
      )

      const chunks: string[] = []
      const onChunk = (chunk: string) => chunks.push(chunk)
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(chunks).toEqual(['Hello', ' World'])
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('14. thinking_delta 触发 onReasoningChunk（与 text_delta 分流）', async () => {
      setAnthropicConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"深度思考..."}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答案"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ])
      )

      const reasoningChunks: string[] = []
      const onReasoningChunk = (chunk: string) => reasoningChunks.push(chunk)
      const contentChunks: string[] = []
      const onChunk = (chunk: string) => contentChunks.push(chunk)

      await streamChat(SAMPLE_MESSAGES, onChunk, vi.fn(), vi.fn(), {
        enableReasoning: true,
        onReasoningChunk,
      })

      // thinking_delta 走 onReasoningChunk
      expect(reasoningChunks).toEqual(['深度思考...'])
      // text_delta 走 onChunk
      expect(contentChunks).toEqual(['答案'])
    })

    it('15. message_start + message_delta 解析 usage（message_delta 保留 message_start 的 promptTokens）', async () => {
      setAnthropicConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
          'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ])
      )

      const onComplete = vi.fn()
      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, vi.fn())

      expect(onComplete).toHaveBeenCalledTimes(1)
      const usage = onComplete.mock.calls[0][0]
      // message_delta 只更新 completionTokens，保留 message_start 设的 promptTokens
      expect(usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    })
  })

  describe('streamOpenAI reasoning 多格式', () => {
    it('16. delta.reasoning 字符串格式触发 onReasoningChunk', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"reasoning":"字符串推理"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const reasoningChunks: string[] = []
      const onReasoningChunk = (c: string) => reasoningChunks.push(c)
      await streamChat(SAMPLE_MESSAGES, vi.fn(), vi.fn(), vi.fn(), {
        enableReasoning: true,
        onReasoningChunk,
      })

      expect(reasoningChunks).toEqual(['字符串推理'])
    })

    it('17. delta.reasoning.summary 数组格式（OpenAI o-series）触发 onReasoningChunk', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createSSEResponse([
          'data: {"choices":[{"delta":{"reasoning":{"summary":[{"text":"摘要1"},{"text":"摘要2"}]}}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )

      const reasoningChunks: string[] = []
      const onReasoningChunk = (c: string) => reasoningChunks.push(c)
      await streamChat(SAMPLE_MESSAGES, vi.fn(), vi.fn(), vi.fn(), {
        enableReasoning: true,
        onReasoningChunk,
      })

      expect(reasoningChunks).toEqual(['摘要1', '摘要2'])
    })

    it('18. streamAnthropic HTTP 错误调 onError（含状态码）', async () => {
      setAnthropicConfig()
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createErrorResponse(401, 'Unauthorized')
      )

      const onError = vi.fn()
      const onComplete = vi.fn()
      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toContain('401')
      expect(onError.mock.calls[0][0].message).toContain('Anthropic API error')
      expect(onComplete).not.toHaveBeenCalled()
    })
  })

  describe('testConnection', () => {
    it('19. OpenAI provider 成功连接返回 success=true', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: async () => '',
      } as unknown as Response)

      const result = await testConnection({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        baseUrl: 'https://test.openai.example/v1',
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('连接成功')
      expect(result.message).toContain('gpt-4o-mini')
      // 验证调用了 OpenAI 端点
      expect(mockedFetchWithTimeout.mock.calls[0][0]).toContain('/chat/completions')
    })

    it('20. Anthropic provider 成功连接使用 /messages 端点', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: async () => '',
      } as unknown as Response)

      const result = await testConnection({
        provider: 'anthropic',
        apiKey: 'sk-ant',
        model: 'claude-3-5-sonnet-20241022',
        baseUrl: 'https://test.anthropic.example/v1',
      })

      expect(result.success).toBe(true)
      expect(mockedFetchWithTimeout.mock.calls[0][0]).toContain('/messages')
      // 验证 Anthropic 请求头
      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const headers = opts.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('sk-ant')
      expect(headers['anthropic-version']).toBe('2023-06-01')
    })

    it('21. HTTP 错误返回 success=false 含状态码', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce(
        createErrorResponse(429, 'Rate limit')
      )

      const result = await testConnection({
        provider: 'openai',
        apiKey: 'sk-test',
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('429')
      expect(result.message).toContain('Rate limit')
    })

    it('22. 网络异常返回 success=false 含错误信息', async () => {
      mockedFetchWithTimeout.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = await testConnection({
        provider: 'openai',
        apiKey: 'sk-test',
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('连接失败')
      expect(result.message).toContain('ECONNREFUSED')
    })

    it('23. custom provider 默认使用 OpenAI baseUrl 和模型', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: async () => '',
      } as unknown as Response)

      // 不传 baseUrl 和 model，验证默认值
      await testConnection({
        provider: 'custom',
        apiKey: 'sk-test',
      })

      const url = mockedFetchWithTimeout.mock.calls[0][0] as string
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const body = JSON.parse(opts.body as string)
      expect(body.model).toBe('gpt-4o-mini')
    })

    it('24. fetch 返回 AbortError（name === "AbortError"）触发 onComplete', async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      mockedFetchWithTimeout.mockRejectedValueOnce(err)

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat([{ role: 'user', content: 'test' }], vi.fn(), onComplete, onError)

      expect(onComplete).toHaveBeenCalledWith(undefined)
      expect(onError).not.toHaveBeenCalled()
    })

    it('25. 已有 active stream 时再次调用会 abort 前一个 controller', async () => {
      const response = createSSEResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n'])
      mockedFetchWithTimeout.mockResolvedValueOnce(response)

      const onComplete1 = vi.fn()
      const onError1 = vi.fn()

      const promise1 = streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete1, onError1)
      const promise2 = streamChat(SAMPLE_MESSAGES, vi.fn(), vi.fn(), vi.fn())

      await Promise.all([promise1, promise2])

      expect(onComplete1).toHaveBeenCalled()
      expect(onError1).not.toHaveBeenCalled()
    })

    it('26. safeComplete 被调用两次时只触发一次 onComplete', async () => {
      const response = createSSEResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n'])
      mockedFetchWithTimeout.mockResolvedValueOnce(response)

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('27. 缺少 baseUrl/model/maxTokens/temperature 时使用 fallback 值', async () => {
      setMinimalOpenAIConfig()

      const response = createSSEResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n'])
      mockedFetchWithTimeout.mockResolvedValueOnce(response)

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      const url = mockedFetchWithTimeout.mock.calls[0][0] as string
      expect(url).toBe('https://api.openai.com/v1/chat/completions')

      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const body = JSON.parse(opts.body as string)
      expect(body.model).toBe('gpt-4o-mini')
      expect(body.max_tokens).toBe(2000)
      expect(body.temperature).toBe(0.7)
    })

    it('28. fetch 返回非取消错误时触发 onError', async () => {
      const err = new Error('network failure')
      mockedFetchWithTimeout.mockRejectedValueOnce(err)

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toContain('network failure')
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('29. response.body 为 null 时触发 onError（No response body）', async () => {
      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: async () => '',
      } as unknown as Response)

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toContain('No response body')
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('30. SSE 行包含无效 JSON 时 catch 块吞掉错误并继续', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {invalid json\n'))
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n'))
          controller.close()
        },
      })

      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream,
        text: async () => '',
      } as unknown as Response)

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(onChunk).toHaveBeenCalledWith('ok')
      expect(onComplete).toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it('31. streamOpenAI 抛出非 Error 对象时触发 onError', async () => {
      mockedFetchWithTimeout.mockRejectedValueOnce('string error')

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(onError.mock.calls[0][0].message).toContain('string error')
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('32. Anthropic provider fallback baseUrl/model/maxTokens', async () => {
      setAIConfig({
        provider: 'anthropic',
        apiKey: 'sk-ant',
      })

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n'))
          controller.enqueue(encoder.encode('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n'))
          controller.enqueue(encoder.encode('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n'))
          controller.close()
        },
      })

      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream,
        text: async () => '',
      } as unknown as Response)

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      const url = mockedFetchWithTimeout.mock.calls[0][0] as string
      expect(url).toBe('https://api.anthropic.com/v1/messages')

      const opts = mockedFetchWithTimeout.mock.calls[0][1] as RequestInit
      const body = JSON.parse(opts.body as string)
      expect(body.model).toBe('claude-3-5-sonnet-20241022')
      expect(body.max_tokens).toBe(2000)

      expect(onChunk).toHaveBeenCalledWith('hi')
      expect(onComplete).toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it('33. Anthropic response.body 为 null 时触发 onError', async () => {
      setAnthropicConfig()

      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: async () => '',
      } as unknown as Response)

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0].message).toContain('No response body')
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('34. Anthropic fetch 返回非 Error 对象时触发 onError', async () => {
      setAnthropicConfig()

      mockedFetchWithTimeout.mockRejectedValueOnce('string error')

      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, vi.fn(), onComplete, onError)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(onError.mock.calls[0][0].message).toContain('string error')
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('35. streamOpenAI reader.cancel() 抛错时仍正常完成', async () => {
      setOpenAIConfig()

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n'))
          controller.close()
        },
        cancel() {
          throw new Error('cancel failed')
        },
      })

      mockedFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream,
        text: async () => '',
      } as unknown as Response)

      const onChunk = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()

      await streamChat(SAMPLE_MESSAGES, onChunk, onComplete, onError)

      expect(onChunk).toHaveBeenCalledWith('hi')
      expect(onComplete).toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })
  })
})
