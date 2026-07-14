import { logger } from '../logger'
import { memoriesDb } from '../database'

const MAX_LONG_TERM = 100

export interface Memory {
  id: string
  type: 'preference' | 'insight' | 'interaction' | 'achievement'
  category: string
  content: string
  importance: number
  context?: string
  createdAt: string
  lastAccessedAt: string
  accessCount: number
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    type: row.type as Memory['type'],
    category: row.category as string,
    content: row.content as string,
    importance: (row.importance as number) ?? 0.5,
    context: (row.context as string) ?? undefined,
    createdAt: row.created_at as string,
    lastAccessedAt: row.last_accessed_at as string,
    accessCount: (row.access_count as number) ?? 0,
  }
}

function addMemory(memory: {
  type: string
  category: string
  content: string
  importance?: number
  context?: string
}): void {
  try {
    memoriesDb.create(memory)
    memoriesDb.deleteOldestBeyond(MAX_LONG_TERM)
    logger.debug('Added memory', { type: memory.type, category: memory.category })
  } catch (error) {
    logger.error('Failed to add memory', error)
  }
}

export function getRelevantMemories(query: string, limit: number = 5): Memory[] {
  try {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
    if (queryTerms.length === 0) return []

    const rows = memoriesDb.getRelevant(queryTerms, limit)
    const memories = rows.map(rowToMemory)

    for (const m of memories) {
      memoriesDb.incrementAccess(m.id)
    }

    return memories
  } catch (error) {
    logger.error('Failed to get relevant memories', error)
    return []
  }
}

export function recordPreference(category: string, preference: string, importance: number = 0.8): void {
  addMemory({ type: 'preference', category, content: preference, importance })
}

export function recordInsight(insight: string, context?: string, importance: number = 0.7): void {
  addMemory({ type: 'insight', category: 'learning', content: insight, importance, context })
}

export function recordInteraction(pattern: string, importance: number = 0.5): void {
  addMemory({ type: 'interaction', category: 'conversation', content: pattern, importance })
}

export function recordAchievement(achievement: string, importance: number = 0.9): void {
  addMemory({ type: 'achievement', category: 'milestone', content: achievement, importance })
}

export function generateMemorySummary(): string {
  try {
    const allMemories = memoriesDb.getAll()
    if (allMemories.length === 0) return ''

    const parts: string[] = []

    const interactions = allMemories
      .filter(m => m.type === 'interaction')
      .slice(0, 3)
    if (interactions.length > 0) {
      parts.push(`最近讨论的话题：${interactions.map(m => m.content).join('、')}`)
    }

    const preferences = allMemories
      .filter(m => m.type === 'preference')
      .slice(0, 3)
    if (preferences.length > 0) {
      parts.push(`用户偏好：${preferences.map(m => m.content).join('、')}`)
    }

    const insights = allMemories
      .filter(m => m.type === 'insight')
      .slice(0, 2)
    if (insights.length > 0) {
      parts.push(`学习洞察：${insights.map(m => m.content).join('、')}`)
    }

    return parts.join('\n')
  } catch (error) {
    logger.error('Failed to generate memory summary', error)
    return ''
  }
}

/**
 * 判断是否存在有意义的记忆数据
 * 只有当存在记忆时才构建记忆上下文
 */
export function hasMemories(): boolean {
  try {
    const allMemories = memoriesDb.getAll()
    return allMemories.length > 0
  } catch {
    return false
  }
}

export function getMemoryStats(): {
  shortTermCount: number
  longTermCount: number
  byType: Record<string, number>
} {
  try {
    const stats = memoriesDb.getStats()
    return {
      shortTermCount: 0,
      longTermCount: stats.total,
      byType: stats.byType,
    }
  } catch (error) {
    logger.error('Failed to get memory stats', error)
    return { shortTermCount: 0, longTermCount: 0, byType: {} }
  }
}

export function clearShortTermMemory(): void {
  // All memories are now long-term (persisted in DB)
}

export function clearAllMemory(): void {
  try {
    memoriesDb.clearAll()
    logger.info('Cleared all memories')
  } catch (error) {
    logger.error('Failed to clear all memories', error)
  }
}

export function extractMemoriesFromConversation(
  userMessage: string,
  assistantResponse: string
): void {
  const preferencePatterns = [
    /(?:我喜欢|我偏好|我习惯|我通常|我总是)/,
    /(?:我不喜欢|我不习惯|我不擅长)/,
  ]

  for (const pattern of preferencePatterns) {
    if (pattern.test(userMessage)) {
      recordPreference('explicit', userMessage.substring(0, 100), 0.8)
      break
    }
  }

  const insightPatterns = [
    /(?:原来|明白了|懂了|理解了|原来是这样)/,
    /(?:这是因为|原因是|根本上)/,
  ]

  for (const pattern of insightPatterns) {
    if (pattern.test(assistantResponse)) {
      const match = assistantResponse.match(/(.{20,50})[。！？]/)
      if (match) {
        recordInsight(match[1], userMessage.substring(0, 50), 0.7)
      }
      break
    }
  }
}
