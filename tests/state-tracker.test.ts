// 知行读书 — state-tracker 单元测试（2026-07-24 首建，2026-09-28 补齐）
//
// 覆盖会话状态管理 + 概念掌握度 + Bloom 难度调整逻辑。
// state-tracker 是 agent orchestrator 的难度自适应核心，纯内存状态。
//
// 2026-09-28 这一批补的是两处"以前只有承诺、没有判据"的地方：
//  - **层级必须真的写回** `currentBloomLevel`。原先它只返回动作，调用方各自算 ±1，
//    而 orchestrator 算完只写进本轮 strategy 对象 ⇒ 层级永远停在 L1，
//    设置页那三条规则（升到 L6、L4 起苏格拉底式、L6 连对 5 次标记已掌握）全不成立。
//  - 模块加载时注册的那个**每小时回收定时器**从来没被跑过（TTL 与超上限腾位置）。
//    下面用一个"重新 import 一份模块"的写法把回调拿到手 —— 不这么做就永远测不到。
//
// ⚠️ 首版里那条「L6 连对 5 次」的用例写着"由 orchestrator 写回"，那是**假设**、
// 不是事实（orchestrator 从没写回），所以它手动把会话摆到 L6 才绿。这类
// "把缺陷写成期望"的判据本次一并改过来。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 必须在 import 之前就好用（vi.mock 的工厂在静态 import 阶段就会被调用），所以用 hoisted
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../electron/logger', () => ({ logger: log }))

import {
  getOrCreateState,
  updateConceptMastery,
  adjustDifficulty,
  clearState,
} from '../electron/agent/state-tracker'

const SID_A = 'test-session-a'
const SID_B = 'test-session-b'

/**
 * 只走真实状态机走到 L6：连对 3 题升一层，所以是 3×5=15 次答对
 * （L1→L6 五层，第 6 层再触发时命中"掌握"分支前先停住）。
 * 返回到顶后读回来的层级 —— 用它就等于把"层级真的写回了状态"这条判据
 * 顺手用上了，不再靠测试自己手改字段伪造一个高层级的现场。
 */
function advanceToL6(sessionId: string): number {
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 3; i++) updateConceptMastery(sessionId, 'c', true)
    const level = adjustDifficulty(sessionId).bloomLevel
    if (level >= 6) return level
  }
  return getOrCreateState(sessionId).currentBloomLevel
}

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
      // 到 L6 只走真实通路（连对 3 题升一层，五轮到顶），不再手动摆层级 ——
      // 首版那句"由 orchestrator 写回"是假设，orchestrator 从来没写回过。
      const state = getOrCreateState(SID_A)
      expect(advanceToL6(SID_A)).toBe(6)
      expect(state.currentBloomLevel).toBe(6)

      for (let i = 0; i < 5; i++) {
        updateConceptMastery(SID_A, 'c', true)
      }
      const result = adjustDifficulty(SID_A)
      expect(result.action).toBe('mark_mastered')
      expect(result.reason).toContain('掌握')
    })

    it('优先级：L6 掌握检查先于普通提升', () => {
      // 走真实通路到 L6，再看"连对 5 次"命中的是掌握而不是再往上提
      advanceToL6(SID_A)
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

describe('层级真的写回会话状态（这一条以前没人钉，而它一直是坏的）', () => {
  beforeEach(() => {
    clearState(SID_A)
    clearState(SID_B)
  })

  it('每一轮升层都真的进一层：L1→L2→L3→L4→L5', () => {
    // 修之前这里是 [2, 2, 2, 2]：每轮都从 L1 重新 +1，
    // 于是"连对 3 题升一层"永远只升半格，苏格拉底式提问（L4 起）永远到不了
    const seen: number[] = []
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 3; i++) updateConceptMastery(SID_A, 'c', true)
      seen.push(adjustDifficulty(SID_A).bloomLevel)
    }
    expect(seen).toEqual([2, 3, 4, 5])
  })

  it('返回的那个 bloomLevel 就是写回后的层级（orchestrator 消费的是它）', () => {
    for (let i = 0; i < 3; i++) updateConceptMastery(SID_A, 'c', true)
    const result = adjustDifficulty(SID_A)
    expect(result.bloomLevel).toBe(getOrCreateState(SID_A).currentBloomLevel)
    expect(result.bloomLevel).toBe(2)
  })

  it('封顶 6、封底 1：到顶不许再往上，一直答错也不许掉到负数', () => {
    expect(advanceToL6(SID_A)).toBe(6)
    expect(getOrCreateState(SID_A).currentBloomLevel).toBe(6)

    for (let round = 0; round < 8; round++) {
      updateConceptMastery(SID_A, 'c', false)
      updateConceptMastery(SID_A, 'c', false)
      adjustDifficulty(SID_A)
    }
    expect(getOrCreateState(SID_A).currentBloomLevel).toBe(1)
  })

  it('maintain 与 mark_mastered 都不许动层级', () => {
    expect(advanceToL6(SID_A)).toBe(6)
    for (let i = 0; i < 5; i++) updateConceptMastery(SID_A, 'c', true)
    expect(adjustDifficulty(SID_A).action).toBe('mark_mastered')
    expect(getOrCreateState(SID_A).currentBloomLevel).toBe(6)

    // 没攒够连续次数的那一轮：层级原样交回去
    updateConceptMastery(SID_A, 'c', true)
    expect(adjustDifficulty(SID_A).action).toBe('maintain')
    expect(adjustDifficulty(SID_A).bloomLevel).toBe(6)
  })

  it('升降层只影响自己这一份会话', () => {
    for (let i = 0; i < 3; i++) updateConceptMastery(SID_A, 'c', true)
    expect(adjustDifficulty(SID_A).bloomLevel).toBe(2)
    expect(getOrCreateState(SID_B).currentBloomLevel).toBe(1)
  })
})

describe('会话回收：模块加载时注册的那个每小时定时器', () => {
  const fired: Array<() => void> = []

  /**
   * 回收函数没有导出，只能把 setInterval 换成"能拿到回调的那一份"再重新 import 一次模块。
   * 每轮都重新 import：状态表是模块级的，不隔离的话上一个用例攒下的会话会漏进这一个。
   */
  async function freshModule() {
    vi.resetModules()
    fired.length = 0
    vi.stubGlobal('setInterval', (cb: () => void) => {
      fired.push(cb)
      return 0 as unknown as NodeJS.Timeout
    })
    vi.stubGlobal('clearInterval', () => {})
    const mod = await import('../electron/agent/state-tracker')
    expect(fired, '模块加载时必须注册一个回收定时器（否则会话永不回收）').toHaveLength(1)
    log.info.mockClear()
    return { mod, runCleanup: () => fired[0]() }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('超过 24 小时没动的会话被清掉，还在动的留着', async () => {
    const { mod, runCleanup } = await freshModule()
    const idle = mod.getOrCreateState('idle-session')
    idle.consecutiveCorrect = 9
    idle.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000)
    mod.getOrCreateState('active-session').consecutiveCorrect = 7

    runCleanup()

    expect(mod.getOrCreateState('active-session').consecutiveCorrect, '还在用的不许被回收').toBe(7)
    expect(mod.getOrCreateState('idle-session').consecutiveCorrect, '过期那条要整份没，不是只清计数').toBe(0)
    expect(log.info).toHaveBeenCalledTimes(1)
  })

  it('24 小时这个档位两头各钉一条（差一分钟就不该清）', async () => {
    const { mod, runCleanup } = await freshModule()
    const justUnder = mod.getOrCreateState('just-under')
    justUnder.consecutiveCorrect = 5
    justUnder.lastActivity = new Date(Date.now() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000))
    const justOver = mod.getOrCreateState('just-over')
    justOver.consecutiveCorrect = 5
    justOver.lastActivity = new Date(Date.now() - (24 * 60 * 60 * 1000 + 60 * 1000))

    runCleanup()

    expect(mod.getOrCreateState('just-under').consecutiveCorrect).toBe(5)
    expect(mod.getOrCreateState('just-over').consecutiveCorrect).toBe(0)
  })

  it('没东西可清时不许记一条日志（否则日志里全是"清理了 0 个"）', async () => {
    const { mod, runCleanup } = await freshModule()
    mod.getOrCreateState('fresh-session')
    runCleanup()
    expect(log.info, '没回收任何东西时不该有日志').not.toHaveBeenCalled()
  })

  it('超过 1000 个会话时按"最近有没有被用过"腾位置，不许踢掉正在用的那一个', async () => {
    const { mod, runCleanup } = await freshModule()
    for (let i = 0; i < 1001; i++) mod.getOrCreateState(`s-${i}`)

    // s-0 创建得最早，但刚刚还在用（这一次取用就是它"最近活跃"的证据）
    mod.getOrCreateState('s-0').consecutiveCorrect = 42

    runCleanup()

    expect(mod.getOrCreateState('s-0').consecutiveCorrect, '刚用过的不许当"最老的"踢掉').toBe(42)
    // s-1 之后再没被取用，才是该被腾掉的那一个
    expect(mod.getOrCreateState('s-1').consecutiveCorrect, '该被腾掉的是最久没被取用的那一个').toBe(0)
  })

  it('会话 id 是空串时也要能腾位置（上限不许因为一个 falsy 的 key 失效）', async () => {
    const { mod, runCleanup } = await freshModule()
    // 空串是最先创建的会话，也是唯一"取到 key 却为 falsy"的那个
    const blank = mod.getOrCreateState('')
    for (let i = 0; i < 1000; i++) mod.getOrCreateState(`s-${i}`)
    // 直接改对象、不再 getOrCreateState —— 免得把它挪到"最近用过"的位置上
    blank.consecutiveCorrect = 11

    runCleanup()

    expect(mod.getOrCreateState('').consecutiveCorrect, '空串 id 的会话也要按上限被腾掉').toBe(0)
  })
})
