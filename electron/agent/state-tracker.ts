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

  while (sessionStates.size > MAX_SESSIONS) {
    const oldestKey = sessionStates.keys().next().value
    if (oldestKey) {
      sessionStates.delete(oldestKey)
      cleaned++
    } else {
      break
    }
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

export function adjustDifficulty(sessionId: string): {
  action: 'increase_bloom' | 'decrease_bloom' | 'mark_mastered' | 'maintain'
  reason: string
} {
  const state = getOrCreateState(sessionId)

  // 先检查最高层级掌握条件（必须在重置前检查）
  if (state.consecutiveCorrect >= 5 && state.currentBloomLevel === 6) {
    state.consecutiveCorrect = 0
    return { action: 'mark_mastered', reason: '创造层答对5次，标记已掌握' }
  }
  // 再检查提升Bloom层级条件
  if (state.consecutiveCorrect >= 3) {
    state.consecutiveCorrect = 0
    return { action: 'increase_bloom', reason: '连续3题答对，提升Bloom层级' }
  }
  if (state.consecutiveWrong >= 2) {
    state.consecutiveWrong = 0
    return { action: 'decrease_bloom', reason: '连续2题答错，降层巩固' }
  }
  return { action: 'maintain', reason: '保持当前难度' }
}

export function clearState(sessionId: string): void {
  sessionStates.delete(sessionId)
}
