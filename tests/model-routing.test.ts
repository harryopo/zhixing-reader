// 模型分级路由（Step 6）：纯函数，钉住「未配置经济档=关闭」「仅白名单意图分流」

import { describe, it, expect } from 'vitest'
import { resolveChatTier, FAST_TIER_INTENTS } from '../src/shared/model-routing'

describe('resolveChatTier — 模型分级路由', () => {
  it('未配置经济档（undefined/null/空串/纯空白）一律 main', () => {
    for (const fast of [undefined, null, '', '   ']) {
      expect(resolveChatTier('casual_chat', fast)).toBe('main')
    }
  })

  it('配置经济档后 casual_chat 走 fast', () => {
    expect(resolveChatTier('casual_chat', 'deepseek-v4-flash-lite')).toBe('fast')
  })

  it('白名单外意图即使配置了经济档也走 main', () => {
    for (const intent of ['knowledge_query', 'deep_discussion', 'teaching_practice', undefined, '']) {
      expect(resolveChatTier(intent, 'fast-model')).toBe('main')
    }
  })

  it('白名单当前只含 casual_chat（扩档需显式修改并过 review）', () => {
    expect(FAST_TIER_INTENTS).toEqual(['casual_chat'])
  })
})
