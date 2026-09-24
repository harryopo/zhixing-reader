import { logger } from '../../logger'
import { articlesDb } from '../../database'
import { buildIndex, searchIndex, type RetrievalDoc } from '../../../src/shared/retrieval'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/** articles 表读出来的行（rowsToObjects 保留数据库列名，即 snake_case） */
type ArticleRow = {
  id?: string
  title_en?: string
  title_zh?: string
  content_en?: string
  content_zh?: string
  summary_zh?: string
  category?: string
  difficulty?: string
  is_read?: number
}

/** 一次最多注入几篇、每篇正文截到多少字（4000 token 预算里给文章留的位置就这么大） */
const MAX_ARTICLES = 2
const MAX_BODY_CHARS = 700

function toDocs(items: ArticleRow[]): { docs: RetrievalDoc[]; byId: Map<string, ArticleRow> } {
  const byId = new Map<string, ArticleRow>()
  const docs = items.map((a, index) => {
    const id = a.id ?? 'article_' + index
    byId.set(id, a)
    return {
      id,
      bookId: '',
      bookTitle: '',
      chapterTitle: a.title_en ?? a.title_zh,
      content: [a.title_en, a.title_zh, a.summary_zh, a.content_en, a.content_zh]
        .filter(Boolean)
        .join('\n'),
    }
  })
  return { docs, byId }
}

function render(a: ArticleRow): string {
  const title = a.title_en || a.title_zh || '（无标题）'
  const parts = [`【${title}】` + (a.title_zh && a.title_en ? ` 中译：${a.title_zh}` : '')]
  if (a.category) parts.push('分类: ' + a.category)
  if (a.difficulty) parts.push('难度: ' + a.difficulty)
  parts.push('状态: ' + (a.is_read ? '已读过' : '未读'))
  const body = (a.content_en || a.content_zh || a.summary_zh || '').trim()
  if (body) {
    parts.push(body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + '…' : body)
  }
  return parts.join('\n')
}

/**
 * 每日学习文章的上下文构建器
 *
 * 2026-09-24 新增：库里存着读过的文章（含中译），但提示词从来不带它 ——
 * 用户问「我之前读过一篇讲 X 的，观点是什么」时 AI 一无所知。
 * 检索与划线/卡片同一套 BM25 + 中文 bigram，不引新依赖；一条都没命中就不注入。
 */
export class ArticleContextBuilder implements ContextBuilder {
  name = 'article'
  /** 低于书籍划线 / 知识卡片 / 方法论：预算紧张时先让位给读者的原始笔记 */
  priority = 55

  shouldBuild(_context: BuildContext): boolean {
    return true
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()
    const empty = (count: number): ContextBuildResult => ({
      content: '',
      priority: this.priority,
      metadata: {
        source: 'database',
        buildTime: Date.now() - startTime,
        itemCount: count,
        method: 'relevance',
      },
    })

    try {
      // 文章不属于某一本书，跨全部取；上限按实际数据量给，避免每次都全表扫
      const articles = articlesDb.getAll(500) as ArticleRow[]
      if (articles.length === 0) return empty(0)

      const { docs, byId } = toDocs(articles)
      const hits = searchIndex(buildIndex(docs), context.userMessage, { limit: MAX_ARTICLES })
      const relevant = hits.map((hit) => byId.get(hit.highlightId)).filter((a): a is ArticleRow => !!a)
      if (relevant.length === 0) return empty(0)

      const body = relevant.map(render).join('\n\n---\n\n')
      const content =
        '\n\n## 用户读过的文章（每日学习）\n' +
        body +
        '\n\n以上是用户读过的原文片段，回答时以此为据并注明出自哪篇；' +
        '如果与问题无关，忽略它们，不要硬扯。'

      logger.info('Article context loaded', {
        count: relevant.length,
        total: articles.length,
      })

      return {
        content,
        priority: this.priority,
        metadata: {
          source: 'database',
          buildTime: Date.now() - startTime,
          itemCount: relevant.length,
          method: 'relevance',
        },
      }
    } catch (error) {
      logger.error('Failed to build article context', error)
      return empty(0)
    }
  }
}
