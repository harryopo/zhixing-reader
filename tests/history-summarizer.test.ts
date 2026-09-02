// 知行读书 — history-summarizer 单元测试（Token 优化 Step 3）
//
// 覆盖 summarizeHistoryIncremental：
//   - 无可用消息 / 空内容 → 降级返回已有摘要，不调用 LLM
//   - 成功摘要 → 返回 trim 后文本，prompt 含已有摘要 + 角色化转录，feature='summary'
//   - 无已有摘要 → prompt 不含「已有摘要」段
//   - LLM 抛错 / 返回空串 → 保守降级返回已有摘要（无则空串）

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }))

vi.mock('../electron/ai-sdk-service', () => ({
  sdkGenerateText: mockGenerateText,
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { summarizeHistoryIncremental } from '../electron/agent/history-summarizer'

type SummarizerMessages = Array<{ role: string; content: string }>
type SummarizerOptions = { maxOutputTokens?: number; temperature?: number; feature?: string }

describe('history-summarizer — summarizeHistoryIncremental', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无可用消息时直接返回已有摘要，不调用 LLM', async () => {
    const result = await summarizeHistoryIncremental('旧摘要', [])
    expect(result).toBe('旧摘要')
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('空内容消息被过滤后无可用消息 → 返回已有摘要', async () => {
    const result = await summarizeHistoryIncremental('旧摘要', [
      { role: 'user', content: '   ' },
    ])
    expect(result).toBe('旧摘要')
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('成功摘要：返回 trim 后文本，prompt 含已有摘要与角色化转录', async () => {
    mockGenerateText.mockResolvedValue('  用户目标：X。已决定：Y。  ')
    const result = await summarizeHistoryIncremental('旧摘要内容', [
      { role: 'user', content: '什么是元认知' },
      { role: 'assistant', content: '元认知是对思考的思考' },
    ])
    expect(result).toBe('用户目标：X。已决定：Y。')

    const calls = mockGenerateText.mock.calls as Array<[SummarizerMessages, SummarizerOptions]>
    const [messages, options] = calls[0]
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('旧摘要内容')
    expect(messages[1].content).toContain('用户: 什么是元认知')
    expect(messages[1].content).toContain('助手: 元认知是对思考的思考')
    expect(options.feature).toBe('summary')
  })

  it('无已有摘要时 prompt 不含「已有摘要」段', async () => {
    mockGenerateText.mockResolvedValue('新摘要')
    await summarizeHistoryIncremental(null, [{ role: 'user', content: 'hi' }])
    const calls = mockGenerateText.mock.calls as Array<[SummarizerMessages, SummarizerOptions]>
    const [messages] = calls[0]
    expect(messages[1].content).not.toContain('已有摘要')
    expect(messages[1].content).toContain('用户: hi')
  })

  it('LLM 抛错时降级返回已有摘要', async () => {
    mockGenerateText.mockRejectedValue(new Error('网络错误'))
    const result = await summarizeHistoryIncremental('旧摘要', [
      { role: 'user', content: '问题' },
    ])
    expect(result).toBe('旧摘要')
  })

  it('LLM 返回空串时降级返回已有摘要', async () => {
    mockGenerateText.mockResolvedValue('   ')
    const result = await summarizeHistoryIncremental('旧摘要', [
      { role: 'user', content: '问题' },
    ])
    expect(result).toBe('旧摘要')
  })

  it('无已有摘要且 LLM 抛错时返回空串', async () => {
    mockGenerateText.mockRejectedValue(new Error('x'))
    const result = await summarizeHistoryIncremental(null, [{ role: 'user', content: '问题' }])
    expect(result).toBe('')
  })
})
