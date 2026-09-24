/**
 * 从服务商返回的用量里取"命中前缀缓存的输入 token"。
 *
 * 为什么单独放一处：这个数决定统计页那句「缓存命中率」，而两条通路（AI SDK 与
 * 手写 fetch）拿到的形状完全不同 —— 之前两边各读各的、且都读了一个**不存在的字段**
 * （AI SDK 侧读 cachedInputTokens、fetch 侧只读 prompt_tokens_details），
 * 结果 DeepSeek 的缓存命中永远记成 0，看起来像"从没命中过"。
 *
 * 读不到就返回 0：宁可如实说没命中，也不拿猜的字段名凑一个好看的数。
 */

/** AI SDK（ai@7）的 usage：真字段是 inputTokenDetails.cacheReadTokens */
export function cachedTokensFromSdkUsage(usage: unknown): number {
  const details = (usage as { inputTokenDetails?: { cacheReadTokens?: number } } | undefined)
    ?.inputTokenDetails
  return positiveOrZero(Number(details?.cacheReadTokens ?? 0))
}

/** 手写 fetch 通路拿到的服务商 usage 原样 JSON */
export function cachedTokensFromProviderUsage(usage: unknown): number {
  const u = usage as
    | {
        prompt_cache_hit_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
    | undefined
  // DeepSeek 用顶层 prompt_cache_hit_tokens；OpenAI 兼容层用嵌套的 cached_tokens
  return positiveOrZero(Number(u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0))
}

function positiveOrZero(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/*
 * 文本 → token 估算。
 *
 * 为什么要有这一份：原来两处各写一套，而且是**互相矛盾**的两套 ——
 * context-manager 按「2 字符/token」估（0.5 token/字），orchestrator 按
 * 「中文 1.5 token/字」估，两者差 3 倍。前者偏松会让 4000 的上下文预算形同虚设，
 * 后者偏紧会白白截断有用的笔记。
 *
 * 校准依据是一次真实对比：发送 2231 字符，服务商报 promptTokens 1386
 * ≈ 0.62 token/字符。这里取 0.65（略偏高 = 保守：宁可早一点截断，
 * 也不要按虚低的估算把预算用超）。纯英文文本会被高估一些，纯中文更接近真值。
 */
export const TOKENS_PER_CHAR = 0.65

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length * TOKENS_PER_CHAR)
}
