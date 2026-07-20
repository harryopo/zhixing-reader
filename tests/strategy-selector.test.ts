// 知行读书 — 教学策略选择器 smoke test（2026-07-20）
//
// 覆盖：selectStrategy / strategyToPromptHint
// 验证：意图 → 策略映射、prompt 提示词获取

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../electron/services/prompt-storage', () => ({
  getPromptTemplate: vi.fn((id: string) => {
    if (id === 'agent.strategy.socratic') return '\n[mock socratic hint]'
    if (id === 'agent.strategy.feynman') return '\n[mock feynman hint]'
    if (id === 'agent.strategy.assessment') return '\n[mock assessment hint]'
    return ''
  }),
}))

import {
  selectStrategy,
  strategyToPromptHint,
  type UserIntent,
} from '../electron/agent/strategy-selector'
import type { StrategyPlan } from '../electron/agent/strategy-selector'

const ALL_INTENTS: UserIntent[] = [
  'knowledge_query',
  'deep_discussion',
  'teaching_practice',
  'casual_chat',
]

describe('Strategy Selector — Smoke Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('selectStrategy', () => {
    it.each(ALL_INTENTS)('should return a plan for %s', (intent) => {
      const plan = selectStrategy(intent)
      expect(plan).toBeDefined()
      expect(['direct_answer', 'socratic', 'feynman', 'assessment']).toContain(plan.teachingMode)
      expect([1, 2, 3, 4, 5, 6]).toContain(plan.bloomLevel)
    })

    it('should map knowledge_query to direct_answer + Bloom 1', () => {
      const plan = selectStrategy('knowledge_query')
      expect(plan.teachingMode).toBe('direct_answer')
      expect(plan.bloomLevel).toBe(1)
    })

    it('should map deep_discussion to socratic + Bloom 3', () => {
      const plan = selectStrategy('deep_discussion')
      expect(plan.teachingMode).toBe('socratic')
      expect(plan.bloomLevel).toBe(3)
    })

    it('should map teaching_practice to feynman + Bloom 2', () => {
      const plan = selectStrategy('teaching_practice')
      expect(plan.teachingMode).toBe('feynman')
      expect(plan.bloomLevel).toBe(2)
    })

    it('should map casual_chat to direct_answer + Bloom 1', () => {
      const plan = selectStrategy('casual_chat')
      expect(plan.teachingMode).toBe('direct_answer')
      expect(plan.bloomLevel).toBe(1)
    })

    it('should return a new object (not mutate shared plan)', () => {
      const a = selectStrategy('knowledge_query')
      const b = selectStrategy('knowledge_query')
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    })
  })

  describe('strategyToPromptHint', () => {
    it('should return socratic hint for socratic mode', () => {
      const plan: StrategyPlan = { teachingMode: 'socratic', bloomLevel: 3 }
      const hint = strategyToPromptHint(plan)
      expect(hint).toContain('socratic')
    })

    it('should return feynman hint for feynman mode', () => {
      const plan: StrategyPlan = { teachingMode: 'feynman', bloomLevel: 2 }
      const hint = strategyToPromptHint(plan)
      expect(hint).toContain('feynman')
    })

    it('should return assessment hint for assessment mode', () => {
      const plan: StrategyPlan = { teachingMode: 'assessment', bloomLevel: 4 }
      const hint = strategyToPromptHint(plan)
      expect(hint).toContain('assessment')
    })

    it('should return empty string for direct_answer mode', () => {
      const plan: StrategyPlan = { teachingMode: 'direct_answer', bloomLevel: 1 }
      const hint = strategyToPromptHint(plan)
      expect(hint).toBe('')
    })
  })
})
