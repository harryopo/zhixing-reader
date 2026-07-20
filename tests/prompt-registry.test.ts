// 知行读书 — 提示词注册表 smoke test（2026-07-20）
//
// 覆盖：PROMPT_REGISTRY 数据完整性
// 所有提示词模板必须可被发现、分类合法、变量定义完整

import { describe, it, expect } from 'vitest'
import { PROMPT_REGISTRY, type PromptCategory, type PromptMeta } from '../electron/services/prompt-registry'

const VALID_CATEGORIES: PromptCategory[] = ['agent', 'intent', 'ai']
const VALID_ROLES: PromptMeta['role'][] = ['system', 'user']

describe('Prompt Registry — Smoke Tests', () => {
  describe('Registry integrity', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(PROMPT_REGISTRY)).toBe(true)
      expect(PROMPT_REGISTRY.length).toBeGreaterThan(0)
    })

    it('should contain at least one agent prompt', () => {
      const agents = PROMPT_REGISTRY.filter((p) => p.category === 'agent')
      expect(agents.length).toBeGreaterThan(0)
    })

    it('should contain the core agent system prompt', () => {
      const system = PROMPT_REGISTRY.find((p) => p.id === 'agent.system')
      expect(system).toBeDefined()
      expect(system?.role).toBe('system')
      expect(system?.defaultTemplate.length).toBeGreaterThan(20)
    })

    it('should contain the intent classification prompt', () => {
      const intent = PROMPT_REGISTRY.find((p) => p.id === 'agent.intentKeywords')
      expect(intent).toBeDefined()
      expect(intent?.category).toBe('intent')
    })
  })

  describe('Per-prompt field validation', () => {
    it.each(PROMPT_REGISTRY.map((p) => [p.id, p]))(
      '%s should have all required fields',
      (_id, prompt) => {
        expect(prompt.id).toBeTruthy()
        expect(typeof prompt.id).toBe('string')
        expect(VALID_CATEGORIES).toContain(prompt.category)
        expect(VALID_ROLES).toContain(prompt.role)
        expect(prompt.title).toBeTruthy()
        expect(prompt.description).toBeTruthy()
        expect(typeof prompt.defaultTemplate).toBe('string')
        expect(prompt.defaultTemplate.length).toBeGreaterThan(0)
        expect(Array.isArray(prompt.variables)).toBe(true)
        expect(typeof prompt.exampleVars).toBe('object')
      }
    )
  })

  describe('Uniqueness', () => {
    it('should have unique prompt ids', () => {
      const ids = PROMPT_REGISTRY.map((p) => p.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })
  })

  describe('Variable declaration integrity', () => {
    it('every variable in exampleVars should also be declared in variables[]', () => {
      for (const p of PROMPT_REGISTRY) {
        const declared = new Set(p.variables.map((v) => v.name))
        for (const key of Object.keys(p.exampleVars)) {
          // 允许 exampleVars 包含占位但不声明（向后兼容），
          // 但若有 variables 声明，exampleVars 中的键必须都在里面
          if (declared.size > 0) {
            expect(declared.has(key)).toBe(true)
          }
        }
      }
    })
  })

  describe('Required prompt feature coverage', () => {
    const requiredIds = [
      'agent.system',
      'agent.intentKeywords',
      'agent.difficultyHint.increase',
      'agent.difficultyHint.decrease',
      'agent.difficultyHint.mastered',
      'agent.strategy.socratic',
      'agent.strategy.feynman',
      'agent.strategy.assessment',
    ]
    it.each(requiredIds)('should contain required prompt: %s', (id) => {
      expect(PROMPT_REGISTRY.find((p) => p.id === id)).toBeDefined()
    })
  })
})
