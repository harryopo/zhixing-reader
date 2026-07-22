// 知行读书 — 提示词注册表测试（2026-07-20 初版 / 2026-07-22 Phase 11 T2 扩展函数覆盖）
//
// 覆盖：
//   1. PROMPT_REGISTRY 数据完整性（smoke）
//   2. 4 个 export 函数：getPromptMeta / getAllPromptIds / getPromptsByCategory / getPromptsByFeature

import { describe, it, expect } from 'vitest'
import {
  PROMPT_REGISTRY,
  getPromptMeta,
  getAllPromptIds,
  getPromptsByCategory,
  getPromptsByFeature,
  type PromptCategory,
  type PromptMeta,
} from '../electron/services/prompt-registry'

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

// ============================================================================
// Phase 11 T2 — 函数行为测试（2026-07-22）
// 目标：4 个 export 函数全覆盖，提升 functions 覆盖率 25% → 100%
// ============================================================================

describe('getPromptMeta', () => {
  it('1. 已存在的 id 返回对应 PromptMeta', () => {
    const meta = getPromptMeta('agent.system')
    expect(meta).toBeDefined()
    expect(meta?.id).toBe('agent.system')
    expect(meta?.category).toBe('agent')
    expect(meta?.role).toBe('system')
    expect(meta?.title).toBe('智能体人设')
  })

  it('2. 已存在的 ai.* id 返回对应 PromptMeta', () => {
    const meta = getPromptMeta('ai.generateCards.user')
    expect(meta).toBeDefined()
    expect(meta?.feature).toBe('generateCards')
    expect(meta?.role).toBe('user')
    expect(meta?.variables).toHaveLength(3)
    expect(meta?.variables.map((v) => v.name)).toEqual(['bookTitle', 'highlightTexts', 'count'])
  })

  it('3. 不存在的 id 返回 undefined', () => {
    expect(getPromptMeta('nonexistent.id')).toBeUndefined()
  })

  it('4. 空字符串 id 返回 undefined', () => {
    expect(getPromptMeta('')).toBeUndefined()
  })

  it('5. REGISTRY_BY_ID 缓存与 PROMPT_REGISTRY 一致（每个 id 都能查到）', () => {
    for (const p of PROMPT_REGISTRY) {
      expect(getPromptMeta(p.id)?.id).toBe(p.id)
    }
  })
})

describe('getAllPromptIds', () => {
  it('6. 返回数组长度等于 PROMPT_REGISTRY 长度', () => {
    const ids = getAllPromptIds()
    expect(ids).toHaveLength(PROMPT_REGISTRY.length)
  })

  it('7. 返回的 id 全部唯一', () => {
    const ids = getAllPromptIds()
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('8. 返回的 id 全部能在 PROMPT_REGISTRY 中找到', () => {
    const ids = getAllPromptIds()
    const registryIds = new Set(PROMPT_REGISTRY.map((p) => p.id))
    for (const id of ids) {
      expect(registryIds.has(id)).toBe(true)
    }
  })

  it('9. 包含核心 id：agent.system 和 ai.generateCards.system', () => {
    const ids = getAllPromptIds()
    expect(ids).toContain('agent.system')
    expect(ids).toContain('ai.generateCards.system')
  })

  it('10. 返回新数组，修改不影响内部状态', () => {
    const ids1 = getAllPromptIds()
    const originalLength = ids1.length
    ids1.push('injected.id')
    const ids2 = getAllPromptIds()
    expect(ids2).toHaveLength(originalLength)
    expect(ids2).not.toContain('injected.id')
  })
})

describe('getPromptsByCategory', () => {
  it('11. category=agent 返回所有 agent 类提示词', () => {
    const agents = getPromptsByCategory('agent')
    expect(agents.length).toBeGreaterThan(0)
    for (const p of agents) {
      expect(p.category).toBe('agent')
    }
  })

  it('12. category=intent 返回意图识别类提示词', () => {
    const intents = getPromptsByCategory('intent')
    expect(intents.length).toBeGreaterThan(0)
    for (const p of intents) {
      expect(p.category).toBe('intent')
    }
  })

  it('13. category=ai 返回所有 AI 功能类提示词', () => {
    const ais = getPromptsByCategory('ai')
    expect(ais.length).toBeGreaterThan(0)
    for (const p of ais) {
      expect(p.category).toBe('ai')
    }
  })

  it('14. 三个 category 的总数等于 PROMPT_REGISTRY 长度', () => {
    const agents = getPromptsByCategory('agent')
    const intents = getPromptsByCategory('intent')
    const ais = getPromptsByCategory('ai')
    expect(agents.length + intents.length + ais.length).toBe(PROMPT_REGISTRY.length)
  })

  it('15. 三个 category 互斥（无重叠）', () => {
    const agents = new Set(getPromptsByCategory('agent').map((p) => p.id))
    const intents = new Set(getPromptsByCategory('intent').map((p) => p.id))
    const ais = new Set(getPromptsByCategory('ai').map((p) => p.id))
    for (const id of agents) {
      expect(intents.has(id)).toBe(false)
      expect(ais.has(id)).toBe(false)
    }
    for (const id of intents) {
      expect(ais.has(id)).toBe(false)
    }
  })

  it('16. 返回新数组，修改不影响内部状态', () => {
    const result1 = getPromptsByCategory('agent')
    const originalLength = result1.length
    result1.push({} as PromptMeta)
    const result2 = getPromptsByCategory('agent')
    expect(result2).toHaveLength(originalLength)
  })
})

describe('getPromptsByFeature', () => {
  it('17. feature=agent 返回所有智能体相关提示词', () => {
    const result = getPromptsByFeature('agent')
    expect(result.length).toBeGreaterThan(0)
    for (const p of result) {
      expect(p.feature).toBe('agent')
    }
  })

  it('18. feature=generateCards 返回生成卡片的 system+user 两个提示词', () => {
    const result = getPromptsByFeature('generateCards')
    expect(result).toHaveLength(2)
    const roles = result.map((p) => p.role).sort()
    expect(roles).toEqual(['system', 'user'])
  })

  it('19. feature=extractMethodologies 返回 system+user 两个', () => {
    const result = getPromptsByFeature('extractMethodologies')
    expect(result).toHaveLength(2)
  })

  it('20. feature=distillKnowledgeCards 返回 system+user 两个', () => {
    const result = getPromptsByFeature('distillKnowledgeCards')
    expect(result).toHaveLength(2)
  })

  it('21. feature=generateSkill 返回 system+user 两个', () => {
    const result = getPromptsByFeature('generateSkill')
    expect(result).toHaveLength(2)
  })

  it('22. 不存在的 feature 返回空数组', () => {
    const result = getPromptsByFeature('nonexistentFeature')
    expect(result).toEqual([])
  })

  it('23. 空字符串 feature 返回空数组', () => {
    const result = getPromptsByFeature('')
    expect(result).toEqual([])
  })

  it('24. 所有 feature 的 system/user 成对出现（feature 内成对律）', () => {
    // 按 feature 分组，每个 feature 至少应有 system 和 user 各一个
    // 例外：agent difficultyHint / strategy 等子类提示词只有 system
    // 这里只校验 ai.* 开头的 feature（业务功能必有 user 消息模板）
    const featureMap = new Map<string, PromptMeta[]>()
    for (const p of PROMPT_REGISTRY) {
      if (p.category === 'ai') {
        if (!featureMap.has(p.feature)) featureMap.set(p.feature, [])
        featureMap.get(p.feature)!.push(p)
      }
    }
    for (const [feature, prompts] of featureMap) {
      const roles = prompts.map((p) => p.role)
      expect(roles).toContain('system')
      expect(roles).toContain('user')
      // 校验函数能正确分组
      expect(getPromptsByFeature(feature)).toHaveLength(prompts.length)
    }
  })

  it('25. 返回新数组，修改不影响内部状态', () => {
    const result1 = getPromptsByFeature('agent')
    const originalLength = result1.length
    result1.push({} as PromptMeta)
    const result2 = getPromptsByFeature('agent')
    expect(result2).toHaveLength(originalLength)
  })
})
