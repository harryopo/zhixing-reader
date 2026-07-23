// 知行读书 — AI SDK service 配置管理 smoke test（2026-07-23）
//
// 覆盖：setAIConfig / cancelActiveStream 的基本行为
// 跳过：所有 LLM 调用函数（依赖真实 API / 网络）—— 留 E2E 测

import { describe, it, expect, beforeEach } from 'vitest'
import { setAIConfig, cancelActiveStream } from '../electron/ai-sdk-service'

describe('AI SDK Service — Smoke Tests', () => {
  describe('setAIConfig', () => {
    beforeEach(() => {
      setAIConfig({
        provider: 'openai',
        apiKey: 'test',
        model: 'gpt-4o-mini',
      })
    })

    it('should accept config without throwing', () => {
      expect(() =>
        setAIConfig({ provider: 'custom', apiKey: 'sk-xxx', model: 'gpt-4o-mini' }),
      ).not.toThrow()
    })

    it('should accept anthropic provider', () => {
      expect(() =>
        setAIConfig({
          provider: 'anthropic',
          apiKey: 'sk-ant-xxx',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-3-5-sonnet',
        }),
      ).not.toThrow()
    })
  })

  describe('cancelActiveStream', () => {
    it('should return false when no active stream', () => {
      const result = cancelActiveStream()
      expect(result).toBe(false)
    })
  })
})
