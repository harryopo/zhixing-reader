import { logger } from '../../logger'
import { methodologiesDb } from '../../database'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * 方法论上下文构建器
 * 从数据库中加载用户已提取的方法论，构建为上下文
 */
export class MethodologyContextBuilder implements ContextBuilder {
  name = 'methodology'
  priority = 80

  shouldBuild(context: BuildContext): boolean {
    return !!context.bookId
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()

    try {
      const methodologies = methodologiesDb.getByBookId(context.bookId!) as Array<{
        name: string
        name_en?: string
        trigger_scenario?: string
        description?: string
        steps?: string
        output_format?: string
        examples?: string
        mastery_level?: number
      }>

      if (methodologies.length === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'database', buildTime: Date.now() - startTime } }
      }

      // 按相关性评分排序
      const userMessage = context.userMessage.toLowerCase()
      const scoredMethodologies = methodologies.map(m => {
        let score = 0

        // 名称匹配（权重最高）
        const name = (m.name || '').toLowerCase()
        const nameEn = (m.name_en || '').toLowerCase()
        if (name.includes(userMessage) || nameEn.includes(userMessage)) {
          score += 10
        }

        // 触发场景匹配
        const triggerScenario = (m.trigger_scenario || '').toLowerCase()
        if (triggerScenario.includes(userMessage)) {
          score += 8
        }

        // 描述匹配
        const description = (m.description || '').toLowerCase()
        if (description.includes(userMessage)) {
          score += 5
        }

        // 关键词匹配（分词）
        const keywords = userMessage.split(/\s+/).filter(k => k.length > 1)
        for (const keyword of keywords) {
          if (name.includes(keyword) || nameEn.includes(keyword)) score += 3
          if (triggerScenario.includes(keyword)) score += 2
          if (description.includes(keyword)) score += 1
        }

        return { methodology: m, score }
      })

      // 按分数降序排序，取前5个（方法论通常较少，限制更严格）
      const relevantMethodologies = scoredMethodologies
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(item => item.methodology)

      const methodTexts = relevantMethodologies.map(m => {
        const parts = [`【${m.name}】${m.name_en ? ` (${m.name_en})` : ''}`]
        if (m.trigger_scenario) parts.push(`触发场景: ${m.trigger_scenario}`)
        if (m.description) parts.push(`描述: ${m.description}`)
        if (m.steps) {
          try {
            const steps = JSON.parse(m.steps)
            if (Array.isArray(steps) && steps.length > 0) {
              parts.push(`步骤: ${steps.join(' → ')}`)
            }
          } catch { /* skip */ }
        }
        if (m.examples) parts.push(`示例: ${m.examples}`)
        if (m.mastery_level && m.mastery_level > 0) {
          parts.push(`掌握度: ${m.mastery_level}%`)
        }
        return parts.join('\n')
      }).join('\n\n---\n\n')

      const content = `\n\n## 用户已提取的方法论\n${methodTexts}\n\n当用户提问时，优先参考这些方法论来回答。如果用户的问题与某个方法论相关，请引用该方法论并给出具体指导。`

      logger.info('Methodology context loaded', { count: relevantMethodologies.length, total: methodologies.length })

      return {
        content,
        priority: this.priority,
        metadata: { source: 'database', buildTime: Date.now() - startTime }
      }
    } catch (error) {
      logger.error('Failed to build methodology context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'database',
          buildTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}
