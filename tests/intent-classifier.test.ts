// 知行读书 — 意图分类器 smoke test（2026-07-20）
//
// 覆盖：classifyIntent 对 4 种意图的分类能力
// 测试不依赖 prompt-storage（通过 vi.mock 隔离）
// 验证：关键词权重、上下文延续、问句模式、负向模式

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 在 import 之前 mock prompt-storage，避免触发 settingsService 等副作用
vi.mock('../electron/services/prompt-storage', () => ({
  getPromptTemplate: vi.fn((id: string) => {
    if (id === 'agent.intentKeywords') return ''
    return ''
  }),
  parseIntentKeywords: vi.fn(() => null),
}))

import { classifyIntent, getIntentKeywords, type UserIntent } from '../electron/agent/intent-classifier'

describe('Intent Classifier — Smoke Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getIntentKeywords', () => {
    it('should return 4 intent categories', () => {
      const kws = getIntentKeywords()
      expect(Object.keys(kws).sort()).toEqual([
        'casual_chat',
        'deep_discussion',
        'knowledge_query',
        'teaching_practice',
      ])
    })

    it('each intent should have at least one keyword', () => {
      const kws = getIntentKeywords()
      for (const intent of Object.keys(kws) as UserIntent[]) {
        expect(kws[intent].length).toBeGreaterThan(0)
      }
    })
  })

  describe('classifyIntent — knowledge_query', () => {
    it('should classify question with "什么是" as knowledge_query', async () => {
      const intent = await classifyIntent('什么是认知行为疗法？', [])
      expect(intent).toBe('knowledge_query')
    })

    it('should classify "解释" as knowledge_query', async () => {
      const intent = await classifyIntent('解释一下神经可塑性', [])
      expect(intent).toBe('knowledge_query')
    })

    it('should classify question without prior context as knowledge_query (default)', async () => {
      const intent = await classifyIntent('serotonin 是怎么工作的？', [])
      expect(['knowledge_query', 'deep_discussion']).toContain(intent)
    })
  })

  describe('classifyIntent — casual_chat', () => {
    it('should classify pure greeting as casual_chat', async () => {
      const intent = await classifyIntent('你好', [])
      expect(intent).toBe('casual_chat')
    })

    it('should classify "谢谢" as casual_chat', async () => {
      const intent = await classifyIntent('谢谢', [])
      expect(intent).toBe('casual_chat')
    })

    it('should classify "明白了" as casual_chat', async () => {
      const intent = await classifyIntent('明白了', [])
      expect(intent).toBe('casual_chat')
    })

    it('should NOT classify as casual_chat if other intent keywords present', async () => {
      const intent = await classifyIntent('好的，请解释一下', [])
      // "解释" 触发 knowledge_query > "好的" 触发 casual_chat
      expect(intent).not.toBe('casual_chat')
    })
  })

  describe('classifyIntent — deep_discussion', () => {
    it('should classify "深入分析" as deep_discussion', async () => {
      const intent = await classifyIntent('深入分析一下这个观点', [])
      expect(intent).toBe('deep_discussion')
    })

    it('should classify "对比" as deep_discussion', async () => {
      const intent = await classifyIntent('对比一下认知疗法和行为疗法', [])
      expect(intent).toBe('deep_discussion')
    })

    it('should classify follow-up when last user message starts with "然后呢"', async () => {
      // isFollowUp 是看 lastUserMsg（不是 current message）
      const history = [
        { role: 'user' as const, content: '前面说到的点' },
        { role: 'assistant' as const, content: '...' },
        { role: 'user' as const, content: '然后呢？' }, // lastUserMsg 以"然后呢"开头
      ]
      const intent = await classifyIntent('还有别的吗？', history)
      expect(intent).toBe('deep_discussion')
    })

    it('should classify "详细说" follow-up as deep_discussion', async () => {
      const history = [
        { role: 'user' as const, content: '说一下背景' },
        { role: 'assistant' as const, content: '...' },
        { role: 'user' as const, content: '详细说' }, // lastUserMsg 以"详细说"开头
      ]
      const intent = await classifyIntent('继续', history)
      expect(intent).toBe('deep_discussion')
    })
  })

  describe('classifyIntent — teaching_practice', () => {
    it('should classify "教我" as teaching_practice', async () => {
      const intent = await classifyIntent('教我如何记忆', [])
      expect(intent).toBe('teaching_practice')
    })

    it('should classify "复习" as teaching_practice', async () => {
      const intent = await classifyIntent('帮我复习昨天的内容', [])
      expect(intent).toBe('teaching_practice')
    })

    it('should classify "考考我" as teaching_practice', async () => {
      const intent = await classifyIntent('考考我', [])
      expect(intent).toBe('teaching_practice')
    })
  })

  describe('classifyIntent — context awareness', () => {
    it('should default to knowledge_query for short non-keyword input', async () => {
      const intent = await classifyIntent('serotonin', [])
      // 没有任何意图关键词，hasQuestionPattern false → 默认 knowledge_query
      expect(intent).toBe('knowledge_query')
    })

    it('should handle empty history gracefully', async () => {
      const intent = await classifyIntent('教我', [])
      expect(intent).toBeTruthy()
    })

    it('should handle long history with defaulting to deep_discussion for questions', async () => {
      // 长历史 + 问句 + 无任何意图关键词 → 走 hasQuestionPattern + history>2 默认分支
      const history = Array(5).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `消息 ${i}`,
      }))
      // 故意选一个没有任何意图关键词的疑问句（无"什么/为什么/怎么/如何/解释/深入/教我..."）
      // "你赞同这个观点吗？" 不在四个意图的关键词列表里，仅触发 hasQuestionPattern（"吗" 是问号变体，但代码只识别 "？" 和 "?"，所以用 "？" 收尾）
      const intent = await classifyIntent('真的是这样吗？', history)
      expect(intent).toBe('deep_discussion')
    })
  })
})
