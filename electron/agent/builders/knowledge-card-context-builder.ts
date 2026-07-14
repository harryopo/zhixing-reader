import { logger } from '../../logger'
import { knowledgeCardsDb } from '../../database'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * 知识卡片上下文构建器
 * 从数据库中加载用户已生成的知识卡片，构建为上下文
 */
export class KnowledgeCardContextBuilder implements ContextBuilder {
  name = 'knowledgeCard'
  priority = 70

  shouldBuild(context: BuildContext): boolean {
    return !!context.bookId
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()

    try {
      const cards = knowledgeCardsDb.getByBookId(context.bookId!) as Array<{
        title: string
        card_type?: string
        content?: string
        interpretation?: string
        application?: string
      }>

      if (cards.length === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'database', buildTime: Date.now() - startTime } }
      }

      // 按相关性排序：与用户消息相关的卡片优先
      const userMessage = context.userMessage.toLowerCase()
      const scoredCards = cards.map(card => {
        let score = 0
        const title = (card.title || '').toLowerCase()
        const content = (card.content || '').toLowerCase()

        // 标题匹配权重最高
        if (title.includes(userMessage)) score += 10
        // 内容匹配次之
        if (content.includes(userMessage)) score += 5

        // 关键词匹配（分词）
        const keywords = userMessage.split(/\s+/).filter(k => k.length > 1)
        for (const keyword of keywords) {
          if (title.includes(keyword)) score += 3
          if (content.includes(keyword)) score += 1
        }

        return { card, score }
      })

      // 按分数降序排序，取前10张
      const relevantCards = scoredCards
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(item => item.card)

      const cardTexts = relevantCards.map(c => {
        const parts = [`【${c.title}】${c.card_type ? ` (${c.card_type})` : ''}`]
        if (c.content) parts.push(`内容: ${c.content}`)
        if (c.interpretation) parts.push(`解读: ${c.interpretation}`)
        if (c.application) parts.push(`应用: ${c.application}`)
        return parts.join('\n')
      }).join('\n\n---\n\n')

      const content = `\n\n## 用户的知识卡片\n${cardTexts}\n\n这些是用户从书中提炼的知识卡片，回答问题时可以引用相关内容。`

      logger.info('Knowledge cards context loaded', { count: relevantCards.length, total: cards.length })

      return {
        content,
        priority: this.priority,
        metadata: { source: 'database', buildTime: Date.now() - startTime }
      }
    } catch (error) {
      logger.error('Failed to build knowledge card context', error)
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
