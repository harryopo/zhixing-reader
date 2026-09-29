import { logger } from '../../logger'
import { retrieveHighlights as retrieveLocalHighlights } from '../../services/rag-service'
import { bookSummariesDb, chapterSummariesDb } from '../../database'
import { buildIndex, searchIndex } from '../../../src/shared/retrieval'
import { formatSummaryContext } from '../../../src/shared/chapter-summaries'
import { CONTEXT_OVERFLOW_HINT } from '../system-prompt'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

type HighlightCtx = {
  /** 划线 id —— 引用来源要靠它定位回原文（此前这一层就丢了） */
  highlightId?: string
  bookId?: string
  content: string
  /** 用户自己写的想法：与正文分开摆，模型才分得清哪句是书里的、哪句是自己的 */
  note?: string
  bookTitle?: string
  chapterTitle?: string
  relevanceScore?: number
}

/**
 * 书籍上下文构建器 —— 两层来源：
 *   1. 层级摘要（L2 全书 + L1 章节，见 services/chapter-summary-service）：只在关联了书时注入，
 *      章节按 BM25 取最相关的 3 章；它回答的是「这本书/这一章大概在讲什么」。
 *   2. 划线原文的本地 BM25 检索（轻量 RAG）：回答的是「原文到底怎么写的」。
 *
 * 2026-09-16 修正：原来 `shouldBuild` 要求**必须先在对话框里关联一本书**，
 * 而从首页进来的对话默认没有选书 —— 这一路被整段跳过，AI 手里一条划线都没有，
 * 只能凭记忆和画像回答关于书的问题（实测默认对话 5 维上下文只剩 2 路）。
 * 现在：选了书就只搜那本书（用户的显式意图），没选书就**跨全部书籍**检索。
 */
export class BookContextBuilder implements ContextBuilder {
  name = 'book'
  priority = 90

  shouldBuild(_context: BuildContext): boolean {
    // 永远参与：没关联书籍时跨全部书检索。
    // 历史：先是按意图 gate（导致"选了书却说没提供任何笔记"），后改成必须有书，
    // 而默认对话根本没有书 —— 于是 934 条划线在默认路径上永远不参与回答。
    return true
  }

  async build(context: BuildContext): Promise<ContextBuildResult> {
    const startTime = Date.now()

    try {
      /*
        划线那一路失败只丢它自己。原来它是这层唯一的 try，一旦下游抛错，连已经读到
        的摘要层一起清零 —— 而下游 rag-service 当时把失败演成了空数组（那层现已把错误
        抛上来）。两层各归各的失败：摘要读不到只降级摘要，划线读不到要一路报到面板。
      */
      let highlights: HighlightCtx[] = []
      let method = 'local'
      let retrievalError: string | undefined
      try {
        const retrieved = await this.retrieveHighlights(context.bookId, context.userMessage)
        highlights = retrieved.items
        method = retrieved.method
      } catch (error) {
        retrievalError = error instanceof Error ? error.message : String(error)
        logger.error('划线检索失败，本轮只带摘要', { bookId: context.bookId, error: retrievalError })
      }
      const failure = retrievalError === undefined ? {} : { error: retrievalError }

      const summaries = context.bookId
        ? this.retrieveSummaries(context.bookId, context.userMessage)
        : { text: '', count: 0, previews: [] }

      if (highlights.length === 0 && summaries.count === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'rag', buildTime: Date.now() - startTime, itemCount: 0, method, ...failure } }
      }

      const notesText = highlights.length === 0 ? '' : this.renderNotes(highlights, context.bookId)

      return {
        content: `${summaries.text}${notesText}`,
        priority: this.priority,
        metadata: {
          source: 'rag',
          buildTime: Date.now() - startTime,
          itemCount: highlights.length + summaries.count,
          method,
          ...failure,
          previews: [
            ...summaries.previews,
            ...highlights.slice(0, 3).map(c => ({
              title: c.chapterTitle || c.bookTitle,
              snippet: c.content.length > 60 ? `${c.content.slice(0, 60)}…` : c.content,
            })),
          ],
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
      // 最外圈兜底：两层各自的失败都在里面处理了，这里只剩"装配本身出意外"这一种情况。
      // 它没有判据 —— 要走进去只能把 buildIndex / formatSummaryContext 这些纯函数 mock 掉，
      // 那是自证式 mock（本项目宁可不盖也不做）。context-manager 对每个构建器也有一层同样的接住。
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
    bookId: string | undefined,
    userMessage: string,
  ): Promise<{ items: HighlightCtx[]; method: string }> {
    const hits = await retrieveLocalHighlights(
      userMessage,
      bookId ? { bookId, limit: 5 } : { limit: 5 },
    )
    return {
      items: hits.map((h) => ({
        highlightId: h.highlightId,
        bookId: h.bookId,
        content: h.content,
        note: h.note,
        bookTitle: h.bookTitle,
        chapterTitle: h.chapterTitle,
        relevanceScore: h.relevanceScore,
      })),
      method: 'local',
    }
  }

  private renderNotes(highlights: HighlightCtx[], bookId: string | undefined): string {
    const contextText = highlights.map(c => {
      const source = c.chapterTitle ? `[${c.chapterTitle}] ` : (c.bookTitle ? `[${c.bookTitle}] ` : '')
      // 想法单列一行并标明是谁写的：混进正文里，模型会把用户自己的想法当成书里的句子引用
      const note = c.note ? `\n（我的想法：${c.note}）` : ''
      return `${source}${c.content}${note}`
    }).join('\n\n') + CONTEXT_OVERFLOW_HINT

    // 没选书时是跨书检索：告诉模型这些片段来自哪、以及不相关可以忽略
    const scopeHint = bookId ? '' : '\n（以上是从你的全部书籍划线中检索出来的，与当前问题无关就忽略）'
    return `\n\n## 阅读笔记\n${contextText}${scopeHint}`
  }

  /**
   * 取这本书的摘要层上下文：L2 全书摘要 + 按 BM25 挑出的 3 章 L1。
   *
   * 一本书只有几十条摘要，每次现建索引的开销可以忽略，因此这里**不做缓存** ——
   * 省掉一整套失效签名逻辑，也不会出现「生成了新摘要但提示词还在用旧的」。
   */
  private retrieveSummaries(
    bookId: string,
    userMessage: string,
  ): { text: string; count: number; previews: Array<{ title: string; snippet: string }> } {
    const empty = { text: '', count: 0, previews: [] }
    let chapters
    let bookSummary: string | null
    try {
      chapters = chapterSummariesDb.getByBookId(bookId)
      /*
        全书摘要按"trim 后有没有内容"判，与真正进提示词的那一份同一个口径：
        formatSummaryContext 会把空白摘要跳过不渲染，而这里的 count 与 previews 以前
        只判真假 ⇒ 一条只有空格的摘要会被报进 itemCount、摆出一条空预览，
        界面说"带了一条全书摘要"而提示词里根本没有它。
      */
      const storedSummary = (bookSummariesDb.getByBookId(bookId)?.summary ?? '').trim()
      bookSummary = storedSummary || null
    } catch (error) {
      // 摘要层是锦上添花：它读不到不该把用户真正的划线上下文一起带走（上面那层才是主菜）
      logger.warn('章节摘要读取失败，本轮只带划线', { bookId, error: String(error) })
      return empty
    }
    if (chapters.length === 0 && !bookSummary) return empty

    const index = buildIndex(chapters.map(c => ({
      id: c.id,
      bookId: c.bookId,
      bookTitle: '',
      chapterTitle: c.chapterTitle,
      content: c.summary,
    })))
    const hits = searchIndex(index, userMessage, { limit: 3, bookId })
    const picked = hits.map(h => ({
      chapterTitle: h.chapterTitle || '相关章节',
      summary: h.content,
    }))

    const text = formatSummaryContext({ bookSummary, chapters: picked })
    return {
      text,
      count: picked.length + (bookSummary ? 1 : 0),
      previews: [
        ...(bookSummary
          ? [{ title: '全书摘要', snippet: truncatePreview(bookSummary) }]
          : []),
        ...picked.map(c => ({ title: c.chapterTitle, snippet: truncatePreview(c.summary) })),
      ],
    }
  }
}

function truncatePreview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
