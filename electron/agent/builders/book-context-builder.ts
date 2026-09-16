import { logger } from '../../logger'
import { semanticSearch, checkRAGAvailability, keywordSearch } from '../../services/rag-service'
import { CONTEXT_OVERFLOW_HINT } from '../system-prompt'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

type HighlightCtx = {
  /** 划线 id —— 引用来源要靠它定位回原文（此前这一层就丢了） */
  highlightId?: string
  bookId?: string
  content: string
  bookTitle?: string
  chapterTitle?: string
  relevanceScore?: number
}

/**
 * 书籍上下文构建器
 * 通过RAG语义搜索或关键词匹配，从书籍笔记中检索相关内容
 */
export class BookContextBuilder implements ContextBuilder {
  name = 'book'
  priority = 90

  shouldBuild(context: BuildContext): boolean {
    // 用户已关联书籍即注入（含闲聊）：此前按意图 gate 导致"选了书却说没提供任何笔记"
    return !!context.bookId
  }

  async build(context: BuildContext): Promise<ContextBuildResult> {
    const startTime = Date.now()

    try {
      const { items: highlights, method, topScore } = await this.retrieveHighlights(context.bookId!, context.userMessage)

      if (highlights.length === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'rag', buildTime: Date.now() - startTime, itemCount: 0, method } }
      }

      const contextText = highlights.map(c => {
        const source = c.chapterTitle ? `[${c.chapterTitle}] ` : (c.bookTitle ? `[${c.bookTitle}] ` : '')
        return `${source}${c.content}`
      }).join('\n\n') + CONTEXT_OVERFLOW_HINT

      return {
        content: `\n\n## 阅读笔记\n${contextText}`,
        priority: this.priority,
        metadata: {
          source: 'rag',
          buildTime: Date.now() - startTime,
          itemCount: highlights.length,
          method,
          topScore,
          previews: highlights.slice(0, 3).map(c => ({
            title: c.chapterTitle || c.bookTitle,
            snippet: c.content.length > 60 ? `${c.content.slice(0, 60)}…` : c.content,
          })),
          // 真实片段：消息气泡的「引用来源」用它，能定位回具体划线
          sources: highlights
            .filter(c => c.highlightId && c.bookId)
            .map(c => ({
              highlightId: c.highlightId as string,
              bookId: c.bookId as string,
              bookTitle: c.bookTitle ?? '',
              chapterTitle: c.chapterTitle,
              content: c.content,
              relevanceScore: c.relevanceScore ?? 0,
            })),
        }
      }
    } catch (error) {
      logger.error('Failed to build book context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'rag',
          buildTime: Date.now() - startTime,
          itemCount: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  private async retrieveHighlights(
    bookId: string,
    userMessage: string,
  ): Promise<{ items: HighlightCtx[]; method: 'semantic' | 'keyword'; topScore?: number }> {
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

        // 语义检索返回 0 条时必须回退到关键词检索。
        // 原来这里是直接 return 空数组 —— 只要索引是空的（或向量里没有这本书的内容），
        // AI 就会带着**零条**书籍上下文回答，而日志还写着"用了语义检索"，完全看不出来。
        if (searchResults.length === 0) {
          logger.info('Semantic search returned 0 results, falling back to keyword matching')
          return this.getKeywordHighlights(bookId, userMessage)
        }

        return {
          items: searchResults.map(r => ({
            highlightId: r.highlightId,
            bookId: r.bookId,
            content: r.content,
            bookTitle: r.bookTitle,
            chapterTitle: r.chapterTitle,
            relevanceScore: r.relevanceScore,
          })),
          method: 'semantic',
          topScore: searchResults[0]?.relevanceScore,
        }
      }

      logger.info('RAG unavailable, falling back to keyword matching')
      return this.getKeywordHighlights(bookId, userMessage)
    } catch (err) {
      logger.error('Failed to retrieve book context, falling back to keywords', err)
      try {
        return this.getKeywordHighlights(bookId, userMessage)
      } catch (fallbackErr) {
        logger.error('Fallback retrieval also failed', fallbackErr)
        return { items: [], method: 'keyword' }
      }
    }
  }

  private getKeywordHighlights(
    bookId: string,
    query: string,
  ): { items: HighlightCtx[]; method: 'semantic' | 'keyword'; topScore?: number } {
    const results = keywordSearch(query, bookId, 5)
    return {
      items: results.map(r => ({
        highlightId: r.highlightId,
        bookId: r.bookId,
        content: r.content,
        bookTitle: r.bookTitle,
        chapterTitle: r.chapterTitle,
        relevanceScore: r.relevanceScore,
      })),
      method: 'keyword',
      topScore: results[0]?.relevanceScore,
    }
  }
}
