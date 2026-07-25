// 知行读书 — memory-service 单元测试（2026-07-24，过夜 Task #6）
//
// 覆盖记忆提取/记录/检索的纯逻辑与 DB 集成行为。
// memory-service 是 agent orchestrator 每轮对话后调用的记忆提取核心，
// 之前 0 单测（仅 database-integration 间接碰过 memoriesDb）。
// 本轮用测试 DB fixture 验证真实写入/检索，不 mock DB。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  recordPreference,
  recordInsight,
  recordInteraction,
  recordAchievement,
  extractMemoriesFromConversation,
  getRelevantMemories,
  hasMemories,
  getMemoryStats,
  generateMemorySummary,
  clearAllMemory,
} from '../electron/services/memory-service'
import { memoriesDb } from '../electron/database'

describe('memory-service — 记录与检索', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  describe('记录类函数', () => {
    it('recordPreference 写入 preference 类型记忆', () => {
      recordPreference('reading', '喜欢读认知科学类书籍')
      const all = memoriesDb.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].type).toBe('preference')
      expect(all[0].category).toBe('reading')
      expect(all[0].importance).toBe(0.8)
    })

    it('recordInsight 写入 insight 类型，category 为 learning', () => {
      recordInsight('元认知是对思考的思考', '什么是元认知')
      const all = memoriesDb.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].type).toBe('insight')
      expect(all[0].category).toBe('learning')
      expect(all[0].importance).toBe(0.7)
      expect(all[0].context).toBe('什么是元认知')
    })

    it('recordInteraction 写入 interaction 类型', () => {
      recordInteraction('用户常问概念定义类问题')
      const all = memoriesDb.getAll()
      expect(all[0].type).toBe('interaction')
      expect(all[0].category).toBe('conversation')
    })

    it('recordAchievement 写入 achievement 类型，importance 最高', () => {
      recordAchievement('连续复习 7 天')
      const all = memoriesDb.getAll()
      expect(all[0].type).toBe('achievement')
      expect(all[0].importance).toBe(0.9)
    })
  })

  describe('extractMemoriesFromConversation', () => {
    it('用户消息含「我喜欢」时提取 preference', () => {
      extractMemoriesFromConversation('我喜欢用费曼方法学习', '好的...')
      const all = memoriesDb.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].type).toBe('preference')
    })

    it('用户消息含「我偏好」时提取 preference', () => {
      extractMemoriesFromConversation('我偏好深度阅读而非泛读', '了解')
      expect(memoriesDb.getAll()[0].type).toBe('preference')
    })

    it('AI 回复含「明白了/原来」时提取 insight', () => {
      extractMemoriesFromConversation(
        '什么是沉没成本？',
        '明白了，沉没成本是指已经发生且无法收回的成本。原来在决策时不应考虑它。',
      )
      const all = memoriesDb.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].type).toBe('insight')
    })

    it('无匹配模式时不提取任何记忆', () => {
      extractMemoriesFromConversation('今天天气不错', '是的呢')
      expect(memoriesDb.getAll()).toHaveLength(0)
    })

    it('preference 内容截断到 100 字符', () => {
      const longMsg = '我喜欢' + 'X'.repeat(200)
      extractMemoriesFromConversation(longMsg, 'ok')
      const all = memoriesDb.getAll()
      expect(all[0].content.length).toBeLessThanOrEqual(100)
    })
  })

  describe('getRelevantMemories', () => {
    beforeEach(() => {
      recordPreference('reading', '喜欢认知科学')
      recordInsight('元认知很重要')
      recordAchievement('读完三本书')
    })

    it('按查询词检索相关记忆', () => {
      const result = getRelevantMemories('认知', 5)
      expect(result.length).toBeGreaterThan(0)
      // 应命中含「认知」的记忆
      expect(result.some((m) => m.content.includes('认知'))).toBe(true)
    })

    it('空查询返回空数组', () => {
      expect(getRelevantMemories('')).toEqual([])
    })

    it('单字符查询词被过滤（长度 ≤ 1）', () => {
      expect(getRelevantMemories('a')).toEqual([])
    })

    it('limit 限制返回数量', () => {
      const result = getRelevantMemories('认知 元认知 读', 1)
      expect(result.length).toBeLessThanOrEqual(1)
    })

    it('检索后访问计数递增', () => {
      getRelevantMemories('认知', 5)
      const all = memoriesDb.getAll()
      const accessed = all.find((m) => (m.access_count as number) > 0)
      expect(accessed).toBeDefined()
    })
  })

  describe('统计与摘要', () => {
    beforeEach(() => {
      recordPreference('reading', '喜欢小说')
      recordInsight('学到了新概念')
      recordInteraction('常问问题')
    })

    it('hasMemories 在有记忆时返回 true', () => {
      expect(hasMemories()).toBe(true)
    })

    it('hasMemories 在无记忆时返回 false', () => {
      clearAllMemory()
      expect(hasMemories()).toBe(false)
    })

    it('getMemoryStats 返回各类型计数', () => {
      const stats = getMemoryStats()
      expect(stats.byType.preference).toBe(1)
      expect(stats.byType.insight).toBe(1)
      expect(stats.byType.interaction).toBe(1)
    })

    it('generateMemorySummary 有记忆时返回非空字符串', () => {
      const summary = generateMemorySummary()
      expect(summary.length).toBeGreaterThan(0)
    })

    it('generateMemorySummary 无记忆时返回空字符串', () => {
      clearAllMemory()
      expect(generateMemorySummary()).toBe('')
    })
  })

  describe('clearAllMemory', () => {
    it('清空所有记忆', () => {
      recordPreference('a', 'b')
      recordInsight('c')
      expect(memoriesDb.getAll().length).toBeGreaterThan(0)
      clearAllMemory()
      expect(memoriesDb.getAll()).toHaveLength(0)
    })
  })
})
