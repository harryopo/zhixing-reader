import { describe, it, expect } from 'vitest'
import {
  cachedTokensFromSdkUsage,
  cachedTokensFromProviderUsage,
  estimateTextTokens,
  TOKENS_PER_CHAR,
} from '../src/shared/usage-tokens'

/**
 * 缓存命中数与 token 估算的判据。
 *
 * 这两样决定统计页上「缓存命中率」与 4000 上下文预算是不是真的。
 * 之前 AI SDK 那条路读的是 cachedInputTokens（ai@7 没这个字段），
 * fetch 那条路只读 prompt_tokens_details.cached_tokens（DeepSeek 用顶层
 * prompt_cache_hit_tokens）—— 两边都永远读不到，命中率记成 0。
 */

describe('缓存命中的输入 token', () => {
  it('AI SDK 通路读 inputTokenDetails.cacheReadTokens', () => {
    expect(
      cachedTokensFromSdkUsage({
        inputTokens: 1200,
        inputTokenDetails: { cacheReadTokens: 1024 },
      }),
    ).toBe(1024)
  })

  it('服务商通路优先读 DeepSeek 的顶层字段，再退到 OpenAI 的嵌套字段', () => {
    expect(cachedTokensFromProviderUsage({ prompt_cache_hit_tokens: 768, prompt_tokens: 1200 })).toBe(768)
    expect(cachedTokensFromProviderUsage({ prompt_tokens_details: { cached_tokens: 512 } })).toBe(512)
  })

  it('没有缓存字段 / usage 缺失 / 负数，一律记 0（不拿猜的字段凑一个好看的数）', () => {
    expect(cachedTokensFromProviderUsage({ prompt_tokens: 1200 })).toBe(0)
    expect(cachedTokensFromSdkUsage(undefined)).toBe(0)
    expect(cachedTokensFromSdkUsage({ inputTokenDetails: { cacheReadTokens: -5 } })).toBe(0)
  })

  it('反证：旧代码读的那个字段现在确实读不到东西（证明这不是空转断言）', () => {
    const real = { inputTokens: 1200, inputTokenDetails: { cacheReadTokens: 1024 } }
    expect((real as Record<string, unknown>).cachedInputTokens).toBeUndefined()
    expect(cachedTokensFromSdkUsage(real)).toBe(1024)
  })
})

describe('token 估算一份口径', () => {
  it('按服务商真值校准（2231 字符 → 1386 token ≈ 0.62）', () => {
    expect(TOKENS_PER_CHAR).toBeGreaterThan(0.6)
    expect(TOKENS_PER_CHAR).toBeLessThan(0.7)
    expect(estimateTextTokens('x'.repeat(2231))).toBeGreaterThan(1380)
    expect(estimateTextTokens('x'.repeat(2231))).toBeLessThan(1520)
  })

  it('空文本估成 0，不估成 NaN', () => {
    expect(estimateTextTokens('')).toBe(0)
  })
})
