import { logger } from '../../logger'
import { retrieveHighlights as retrieveLocalHighlights } from '../../services/rag-service'
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

  /**
   * 取与问题最相关的划线段落。
   *
   * 只有一条路：本地 BM25 检索。原来的「语义检索 + 关键词兜底」两条路已经删除 ——
   * 语义那条在本机从来没通（服务商不支持 embeddings），而它的失败是**静默的**：
   * 返回空数组、日志写 Using RAG semantic search，AI 就带着零条上下文回答。
   */
  private async retrieveHighlights(
    bookId: string,
    userMessage: string,
  ): Promise<{ items: HighlightCtx[]; method: string; topScore?: number }> {
    const hits = await retrieveLocalHighlights(userMessage, { bookId, limit: 5 })
    return {
      items: hits.map((h) => ({
        highlightId: h.highlightId,
        bookId: h.bookId,
        content: h.content,
        bookTitle: h.bookTitle,
        chapterTitle: h.chapterTitle,
        relevanceScore: h.relevanceScore,
      })),
      method: 'local',
      topScore: hits[0]?.relevanceScore,
    }
  }
}
