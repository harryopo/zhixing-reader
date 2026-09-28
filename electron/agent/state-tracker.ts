import { logger } from '../logger'

type BloomLevel = 1 | 2 | 3 | 4 | 5 | 6
type MasteryLevel = 0 | 1 | 2 | 3 | 4 | 5

interface ConceptState {
  conceptName: string
  masteryLevel: MasteryLevel
  bloomLevel: BloomLevel
  lastAssessedAt: Date
  knowledgeGaps: string[]
}

interface ConversationState {
  sessionId: string
  currentBookId?: string
  currentChapter?: string
  conceptStates: Map<string, ConceptState>
  currentBloomLevel: BloomLevel
  consecutiveCorrect: number
  consecutiveWrong: number
  recentTopics: string[]
  lastActivity: Date
}

const sessionStates = new Map<string, ConversationState>()

const MAX_SESSIONS = 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

function cleanupOldSessions(): void {
  const now = Date.now()
  let cleaned = 0

  for (const [id, state] of sessionStates) {
    if (now - state.lastActivity.getTime() > SESSION_TTL_MS) {
      sessionStates.delete(id)
      cleaned++
    }
  }

  // 超上限时从"最久没被取用"的那个开始腾位置。
  // 原先写的是 `if (oldestKey) ... else break`：一来那个 else 永远走不到（进到循环里
  // map 必非空），二来会话 id 是外部传进来的字符串，空串是 falsy ——
  // 于是"上限 1000"会因为一个空串 id 直接失效，越限的内存再也腾不下去。
  for (const oldestKey of sessionStates.keys()) {
    if (sessionStates.size <= MAX_SESSIONS) break
    sessionStates.delete(oldestKey)
    cleaned++
  }

  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} old sessions, remaining: ${sessionStates.size}`)
  }
}

const _cleanupTimer = setInterval(cleanupOldSessions, CLEANUP_INTERVAL_MS)

export function getOrCreateState(sessionId: string): ConversationState {
  let state = sessionStates.get(sessionId)
  if (!state) {
    state = {
      sessionId,
      conceptStates: new Map(),
      currentBloomLevel: 1,
      consecutiveCorrect: 0,
      consecutiveWrong: 0,
      recentTopics: [],
      lastActivity: new Date(),
    }
    sessionStates.set(sessionId, state)
  } else {
    // Map 的迭代顺序是**插入**顺序，不是使用时间顺序。超上限腾位置时按这个顺序删，
    // 所以要让"刚被用过"的会话排到最后 —— 否则一个一直在用的会话会因为"创建得早"
    // 被当成最老的会话踢掉，用户侧的表现是聊到一半难度与已掌握概念突然清零。
    sessionStates.delete(sessionId)
    sessionStates.set(sessionId, state)
  }
  state.lastActivity = new Date()
  return state
}

export function updateConceptMastery(
  sessionId: string,
  concept: string,
  correct: boolean
): void {
  const state = getOrCreateState(sessionId)

  if (correct) {
    state.consecutiveCorrect++
    state.consecutiveWrong = 0
  } else {
    state.consecutiveWrong++
    state.consecutiveCorrect = 0
  }

  const existing = state.conceptStates.get(concept)
  if (existing) {
    existing.masteryLevel = Math.min(5, existing.masteryLevel + (correct ? 1 : 0)) as MasteryLevel
    existing.lastAssessedAt = new Date()
  } else {
    state.conceptStates.set(concept, {
      conceptName: concept,
      masteryLevel: (correct ? 1 : 0) as MasteryLevel,
      bloomLevel: 1,
      lastAssessedAt: new Date(),
      knowledgeGaps: [],
    })
  }
}

/**
 * 难度调整：判定 + **落盘到会话状态**。
 *
 * 层级必须在这里写回 `state.currentBloomLevel`。此前它只返回一个动作、
 * 由调用方各自算 ±1，而调用方算完只写进了本轮的 strategy 对象 ——
 * 于是 `currentBloomLevel` 从创建到销毁恒为 1：
 * 「连续 3 题答对升一层」每轮都从 L1 重新算，跨轮次永远升不上去；
 * 「L6 连对 5 次标记已掌握」的条件（`currentBloomLevel === 6`）因此永远不成立，
 * 设置页那三条规则与苏格拉底式提问（L4 起）都停在纸面上。
 * 现在层级只有一个所有者，返回的 `bloomLevel` 就是写回后的那一层。
 */
export function adjustDifficulty(sessionId: string): {
  action: 'increase_bloom' | 'decrease_bloom' | 'mark_mastered' | 'maintain'
  reason: string
  bloomLevel: BloomLevel
} {
  const state = getOrCreateState(sessionId)

  // 先检查最高层级掌握条件（必须在重置前检查）
  if (state.consecutiveCorrect >= 5 && state.currentBloomLevel === 6) {
    state.consecutiveCorrect = 0
    return { action: 'mark_mastered', reason: '创造层答对5次，标记已掌握', bloomLevel: 6 }
  }
  // 再检查提升Bloom层级条件
  if (state.consecutiveCorrect >= 3) {
    state.consecutiveCorrect = 0
    state.currentBloomLevel = Math.min(6, state.currentBloomLevel + 1) as BloomLevel
    return {
      action: 'increase_bloom',
      reason: '连续3题答对，提升Bloom层级',
      bloomLevel: state.currentBloomLevel,
    }
  }
  if (state.consecutiveWrong >= 2) {
    state.consecutiveWrong = 0
    state.currentBloomLevel = Math.max(1, state.currentBloomLevel - 1) as BloomLevel
    return {
      action: 'decrease_bloom',
      reason: '连续2题答错，降层巩固',
      bloomLevel: state.currentBloomLevel,
    }
  }
  return { action: 'maintain', reason: '保持当前难度', bloomLevel: state.currentBloomLevel }
}

export function clearState(sessionId: string): void {
  sessionStates.delete(sessionId)
}
