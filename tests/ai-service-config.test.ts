// 知行读书 — AI service 配置管理 smoke test（2026-07-20）
//
// 覆盖：setAIConfig / getAIConfig / initFromSettings
// 跳过：所有 LLM 调用函数（依赖真实 API / 网络）—— 留 E2E 测

import { describe, it, expect, beforeEach } from 'vitest'
import { setAIConfig, getAIConfig, initFromSettings } from '../electron/ai-service'
import type { AIServiceConfig } from '../electron/ai-service'

describe('AI Service Config — Smoke Tests', () => {
  beforeEach(() => {
    // 重置为 null
    setAIConfig({
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4o-mini',
    } as AIServiceConfig)
  })

  describe('setAIConfig / getAIConfig', () => {
    it('should return set config via get', () => {
      const cfg: AIServiceConfig = {
        provider: 'openai',
        apiKey: 'sk-xxx',
        model: 'gpt-4o-mini',
      }
      setAIConfig(cfg)
      expect(getAIConfig()).toBe(cfg)
    })

    it('should overwrite previous config', () => {
      setAIConfig({ provider: 'openai', apiKey: 'a', model: 'gpt-4o-mini' } as AIServiceConfig)
      setAIConfig({ provider: 'anthropic', apiKey: 'b', model: 'claude-3-5-sonnet' } as AIServiceConfig)
      const cfg = getAIConfig()
      expect(cfg?.provider).toBe('anthropic')
      expect(cfg?.apiKey).toBe('b')
    })
  })

  describe('initFromSettings', () => {
    it('should initialize config when llmKey is present', () => {
      initFromSettings({
        llmKey: 'sk-test-123',
        aiProvider: 'openai',
        llmEndpoint: 'https://api.openai.com/v1',
        llmModel: 'gpt-4o-mini',
      })
      const cfg = getAIConfig()
      expect(cfg).toBeTruthy()
      expect(cfg?.apiKey).toBe('sk-test-123')
      expect(cfg?.provider).toBe('openai')
      expect(cfg?.baseUrl).toBe('https://api.openai.com/v1')
      expect(cfg?.model).toBe('gpt-4o-mini')
    })

    it('should default provider to "custom" when not specified', () => {
      initFromSettings({ llmKey: 'k' })
      const cfg = getAIConfig()
      expect(cfg?.provider).toBe('custom')
    })

    it('should NOT initialize config when llmKey is missing', () => {
      // 先设一个非 null 状态
      setAIConfig({ provider: 'openai', apiKey: 'before', model: 'gpt-4o' } as AIServiceConfig)
      initFromSettings({}) // 没有 llmKey
      const cfg = getAIConfig()
      // 应保持原值不变
      expect(cfg?.apiKey).toBe('before')
    })

    it('should apply default maxTokens and temperature', () => {
      initFromSettings({ llmKey: 'k' })
      const cfg = getAIConfig()
      expect(cfg?.maxTokens).toBe(2000)
      expect(cfg?.temperature).toBe(0.7)
    })
  })
})
