import { logger } from '../../logger'
import { getRelevantMemories, generateMemorySummary, hasMemories } from '../../services/memory-service'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * 记忆上下文构建器
 * 加载与用户消息相关的记忆信息，构建为上下文
 */
export class MemoryContextBuilder implements ContextBuilder {
  name = 'memory'
  priority = 50

  shouldBuild(_context: BuildContext): boolean {
    // 只有当存在记忆时才构建
    return hasMemories()
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()

    try {
      const relevantMemories = getRelevantMemories(context.userMessage, 3)
      const memorySummary = generateMemorySummary()

      if (relevantMemories.length === 0 && !memorySummary) {
        return { content: '', priority: this.priority, metadata: { source: 'memory-service', buildTime: Date.now() - startTime } }
      }

      const memoryParts: string[] = []
      if (memorySummary) memoryParts.push(memorySummary)
      if (relevantMemories.length > 0) {
        memoryParts.push(`相关记忆：\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`)
      }

      const content = `\n\n## 记忆上下文\n${memoryParts.join('\n\n')}\n\n基于用户的记忆和历史偏好来个性化回答。`

      logger.info('Memory context loaded', {
        relevantCount: relevantMemories.length,
        hasSummary: !!memorySummary,
      })

      return {
        content,
        priority: this.priority,
        metadata: { source: 'memory-service', buildTime: Date.now() - startTime }
      }
    } catch (error) {
      logger.error('Failed to build memory context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'memory-service',
          buildTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}
