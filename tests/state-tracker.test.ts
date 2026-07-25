// 知行读书 — state-tracker 单元测试（2026-07-24，过夜 Task #7）
//
// 覆盖会话状态管理 + 概念掌握度 + Bloom 难度调整逻辑。
// state-tracker 是 agent orchestrator 的难度自适应核心，纯内存状态，0 单测。
// 本轮验证：升降级规则、掌握标记、概念计数、会话隔离。

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getOrCreateState,
  updateConceptMastery,
  adjustDifficulty,
  clearState,
} from '../electron/agent/state-tracker'

const SID_A = 'test-session-a'
const SID_B = 'test-session-b'

describe('state-tracker — 会话状态管理', () => {
  beforeEach(() => {
    clearState(SID_A)
    clearState(SID_B)
  })

  describe('getOrCreateState', () => {
    it('首次获取创建新会话，默认 Bloom L1', () => {
      const state = getOrCreateState(SID_A)
      expect(state.sessionId).toBe(SID_A)
      expect(state.currentBloomLevel).toBe(1)
      expect(state.consecutiveCorrect).toBe(0)
      expect(state.consecutiveWrong).toBe(0)
      expect(state.conceptStates.size).toBe(0)
    })

    it('重复获取返回同一会话实例', () => {
      const s1 = getOrCreateState(SID_A)
      const s2 = getOrCreateState(SID_A)
      expect(s1).toBe(s2)
    })

    it('不同会话相互隔离', () => {
      const sa = getOrCreateState(SID_A)
      const sb = getOrCreateState(SID_B)
      expect(sa).not.toBe(sb)
      expect(sa.sessionId).toBe(SID_A)
      expect(sb.sessionId).toBe(SID_B)
    })

    it('每次获取更新 lastActivity', async () => {
      const s1 = getOrCreateState(SID_A)
      const t1 = s1.lastActivity.getTime()
      await new Promise((r) => setTimeout(r, 5))
      const s2 = getOrCreateState(SID_A)
      expect(s2.lastActivity.getTime()).toBeGreaterThanOrEqual(t1)
    })
  })

  describe('updateConceptMastery', () => {
    it('答对：consecutiveCorrect 递增，consecutiveWrong 清零', () => {
      updateConceptMastery(SID_A, '元认知', true)
      const state = getOrCreateState(SID_A)
      expect(state.consecutiveCorrect).toBe(1)
      expect(state.consecutiveWrong).toBe(0)
    })

    it('答错：consecutiveWrong 递增，consecutiveCorrect 清零', () => {
      updateConceptMastery(SID_A, '元认知', true)
      updateConceptMastery(SID_A, '元认知', false)
      const state = getOrCreateState(SID_A)
      expect(state.consecutiveCorrect).toBe(0)
      expect(state.consecutiveWrong).toBe(1)
    })

    it('新概念答对：masteryLevel 初始为 1', () => {
      updateConceptMastery(SID_A, '新概念', true)
      const state = getOrCreateState(SID_A)
      const concept = state.conceptStates.get('新概念')
      expect(concept?.masteryLevel).toBe(1)
    })

    it('新概念答错：masteryLevel 初始为 0', () => {
      updateConceptMastery(SID_A, '新概念', false)
      const state = getOrCreateState(SID_A)
      const concept = state.conceptStates.get('新概念')
      expect(concept?.masteryLevel).toBe(0)
    })

    it('已存在概念答对：masteryLevel 递增', () => {
      updateConceptMastery(SID_A, '概念X', true)
      updateConceptMastery(SID_A, '概念X', true)
      const state = getOrCreateState(SID_A)
      expect(state.conceptStates.get('概念X')?.masteryLevel).toBe(2)
    })

    it('答错不降低 masteryLevel（只清零 consecutiveCorrect）', () => {
      updateConceptMastery(SID_A, '概念X', true)
      updateConceptMastery(SID_A, '概念X', true)
      updateConceptMastery(SID_A, '概念X', false)
      const state = getOrCreateState(SID_A)
      // masteryLevel 保持 2，不因答错降低
      expect(state.conceptStates.get('概念X')?.masteryLevel).toBe(2)
    })

    it('masteryLevel 上限 5', () => {
      for (let i = 0; i < 10; i++) {
        updateConceptMastery(SID_A, '概念X', true)
      }
      const state = getOrCreateState(SID_A)
      expect(state.conceptStates.get('概念X')?.masteryLevel).toBe(5)
    })
  })

  describe('adjustDifficulty — 升降级规则', () => {
    it('无答题记录时保持难度', () => {
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('maintain')
      expect(result.reason).toContain('保持')
    })

    it('连续 3 题答对 → 提升层级', () => {
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_A, 'c', true)
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('increase_bloom')
      expect(result.reason).toContain('提升')
    })

    it('提升后 consecutiveCorrect 清零', () => {
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_A, 'c', true)
      adjustDifficulty(SID_A)
      const state = getOrCreateState(SID_A)
      expect(state.consecutiveCorrect).toBe(0)
    })

    it('连续 2 题答错 → 降低层级', () => {
      updateConceptMastery(SID_A, 'c', false)
      updateConceptMastery(SID_A, 'c', false)
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('decrease_bloom')
      expect(result.reason).toContain('降层')
    })

    it('降低后 consecutiveWrong 清零', () => {
      updateConceptMastery(SID_A, 'c', false)
      updateConceptMastery(SID_A, 'c', false)
      adjustDifficulty(SID_A)
      const state = getOrCreateState(SID_A)
      expect(state.consecutiveWrong).toBe(0)
    })

    it('混合答题不触发升降级（1对1错）', () => {
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_A, 'c', false)
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('maintain')
    })

    it('L6 创造层连续 5 题答对 → 标记掌握', () => {
      // adjustDifficulty 不自改 currentBloomLevel（由 orchestrator 写回），
      // 这里直接把会话设到 L6 模拟已到顶层
      const state = getOrCreateState(SID_A)
      state.currentBloomLevel = 6

      // 连续答对 5 次
      for (let i = 0; i < 5; i++) {
        updateConceptMastery(SID_A, 'c', true)
      }
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('mark_mastered')
      expect(result.reason).toContain('掌握')
    })

    it('优先级：L6 掌握检查先于普通提升', () => {
      // 在 L6 且连续答对 5 次，应标记掌握而非再提升
      const state = getOrCreateState(SID_A)
      state.currentBloomLevel = 6
      for (let i = 0; i < 5; i++) {
        updateConceptMastery(SID_A, 'c', true)
      }
      const result = adjustDifficulty(SID_A)
      expect(result.action).not.toBe('increase_bloom')
      expect(result.action).toBe('mark_mastered')
    })
  })

  describe('clearState', () => {
    it('清除指定会话状态', () => {
      updateConceptMastery(SID_A, 'c', true)
      clearState(SID_A)
      const state = getOrCreateState(SID_A)
      // 清除后重新获取是新会话
      expect(state.consecutiveCorrect).toBe(0)
      expect(state.conceptStates.size).toBe(0)
    })

    it('清除一个会话不影响其他会话', () => {
      updateConceptMastery(SID_A, 'c', true)
      updateConceptMastery(SID_B, 'c', true)
      clearState(SID_A)
      const sa = getOrCreateState(SID_A)
      const sb = getOrCreateState(SID_B)
      expect(sa.consecutiveCorrect).toBe(0)
      expect(sb.consecutiveCorrect).toBe(1)
    })

    it('清除不存在的会话不报错', () => {
      expect(() => clearState('nonexistent')).not.toThrow()
    })
  })
})
