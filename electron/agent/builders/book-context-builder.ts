import { logger } from '../../logger'
import { semanticSearch, checkRAGAvailability, keywordSearch } from '../../services/rag-service'
import { CONTEXT_OVERFLOW_HINT } from '../system-prompt'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

type HighlightCtx = { content: string; bookTitle?: string; chapterTitle?: string }

/**
 * 书籍上下文构建器
 * 通过RAG语义搜索或关键词匹配，从书籍笔记中检索相关内容
 */
export class BookContextBuilder implements ContextBuilder {
  name = 'book'
  priority = 90

  shouldBuild(context: BuildContext): boolean {
    if (!context.bookId) return false
    // 只在首次对话或知识查询/深度讨论时注入上下文
    if (context.conversationHistory.length === 0) return true
    const intent = context.intent
    return intent === 'knowledge_query' || intent === 'deep_discussion'
  }

  async build(context: BuildContext): Promise<ContextBuildResult> {
    const startTime = Date.now()

    try {
      const highlights = await this.retrieveHighlights(context.bookId!, context.userMessage)

      if (highlights.length === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'rag', buildTime: Date.now() - startTime } }
      }

      const contextText = highlights.map(c => {
        const source = c.chapterTitle ? `[${c.chapterTitle}] ` : (c.bookTitle ? `[${c.bookTitle}] ` : '')
        return `${source}${c.content}`
      }).join('\n\n') + CONTEXT_OVERFLOW_HINT

      return {
        content: `\n\n## 阅读笔记\n${contextText}`,
        priority: this.priority,
        metadata: { source: 'rag', buildTime: Date.now() - startTime }
      }
    } catch (error) {
      logger.error('Failed to build book context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'rag',
          buildTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  private async retrieveHighlights(bookId: string, userMessage: string): Promise<HighlightCtx[]> {
    try {
      const ragAvailable = await checkRAGAvailability()

      if (ragAvailable) {
        logger.info('Using RAG semantic search')
        const searchResults = await semanticSearch(userMessage, { limit: 5, bookId })
        logger.info('RAG retrieval', {
          query: userMessage.substring(0, 50),
          results: searchResults.length,
          topScore: searchResults[0]?.relevanceScore,
        })
        return searchResults.map(r => ({
          content: r.content,
          bookTitle: r.bookTitle,
          chapterTitle: r.chapterTitle,
        }))
      }

      logger.info('RAG unavailable, falling back to keyword matching')
      return this.getKeywordHighlights(bookId, userMessage)
    } catch (err) {
      logger.error('Failed to retrieve book context, falling back to keywords', err)
      try {
        return this.getKeywordHighlights(bookId, userMessage)
      } catch (fallbackErr) {
        logger.error('Fallback retrieval also failed', fallbackErr)
        return []
      }
    }
  }

  private getKeywordHighlights(bookId: string, query: string): HighlightCtx[] {
    return keywordSearch(query, bookId, 5).map(r => ({
      content: r.content,
      bookTitle: r.bookTitle,
      chapterTitle: r.chapterTitle,
    }))
  }
}
