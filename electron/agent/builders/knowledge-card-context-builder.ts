import { logger } from '../../logger'
import { knowledgeCardsDb } from '../../database'
import { buildIndex, searchIndex, type RetrievalDoc } from '../../../src/shared/retrieval'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/** knowledge_cards 表读出来的行（rowsToObjects 保留数据库列名，即 snake_case） */
type CardRow = {
  id?: string
  book_id?: string
  book_title?: string
  type?: string
  title?: string
  content?: string
  interpretation?: string
  application?: string
}

/**
 * 把卡片行转成检索文档，并留下 id -> 行 的索引（命中后要拿回原行渲染）
 */
function toDocs(cards: CardRow[]): { docs: RetrievalDoc[]; byId: Map<string, CardRow> } {
  const byId = new Map<string, CardRow>()
  const docs = cards.map((card, index) => {
    const id = card.id ?? 'card_' + index
    byId.set(id, card)
    return {
      id,
      bookId: card.book_id ?? '',
      bookTitle: card.book_title ?? '',
      chapterTitle: card.title,
      content: [card.title, card.content, card.interpretation, card.application]
        .filter(Boolean)
        .join('\n'),
    }
  })
  return { docs, byId }
}

/**
 * 知识卡片上下文构建器
 *
 * 2026-09-16 三处修正（都是「看着在工作、其实没工作」）：
 *   1. **不再要求先关联书籍**。原来 shouldBuild 是 `!!context.bookId`，而从首页进来的对话
 *      默认没有选书 —— 这一路被整段跳过，「调取知识库」面板里连一行都不显示，AI 手里
 *      一张卡片都没有（实测默认对话的 5 维上下文只剩「相关记忆 + 用户画像」两路）。
 *      现在没选书就跨全部卡片检索。
 *   2. **打分改用与划线检索同一套中文分词（BM25）**。原来是拿用户**整句**去
 *      `content.includes(...)`，而中文没有空格 —— 这句话几乎永远为 false，于是
 *      「相关卡片」实际上按数据库顺序随便取 10 张（分数全是 0）注入给模型。
 *   3. **卡片类型原来读的是不存在的字段** `card_type`（列名是 `type`），所以
 *      「【卡名】(类型)」里的类型从来没显示过。
 *
 * 现在：只注入真正命中的卡片；一张都没命中就不注入（面板如实显示「无命中」）。
 */
export class KnowledgeCardContextBuilder implements ContextBuilder {
  name = 'knowledgeCard'
  priority = 70

  shouldBuild(): boolean {
    return true
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()

    try {
      const cards = (
        context.bookId ? knowledgeCardsDb.getByBookId(context.bookId) : knowledgeCardsDb.getAll()
      ) as CardRow[]

      if (cards.length === 0) {
        return {
          content: '',
          priority: this.priority,
          metadata: { source: 'database', buildTime: Date.now() - startTime, itemCount: 0, method: 'relevance' },
        }
      }

      // 用与「划线检索」同一套纯函数打分：中文 2 字滑窗 + BM25 + 相对分截断
      const { docs, byId } = toDocs(cards)
      const hits = searchIndex(buildIndex(docs), context.userMessage, { limit: 10 })
      const relevantCards = hits
        .map((hit) => byId.get(hit.highlightId)) // 注意：searchIndex 把 doc.id 改名成 highlightId 返回
        .filter((card): card is CardRow => !!card)

      if (relevantCards.length === 0) {
        return {
          content: '',
          priority: this.priority,
          metadata: { source: 'database', buildTime: Date.now() - startTime, itemCount: 0, method: 'relevance' },
        }
      }

      const cardTexts = relevantCards
        .map((c) => {
          const parts = ['【' + (c.title ?? '') + '】' + (c.type ? ' (' + c.type + ')' : '')]
          if (c.content) parts.push('内容: ' + c.content)
          if (c.interpretation) parts.push('解读: ' + c.interpretation)
          if (c.application) parts.push('应用: ' + c.application)
          return parts.join('\n')
        })
        .join('\n\n---\n\n')

      const content = '\n\n## 用户的知识卡片\n' + cardTexts + '\n\n这些是用户从书中提炼的知识卡片，回答问题时可以引用相关内容。'

      logger.info('Knowledge cards context loaded', {
        count: relevantCards.length,
        total: cards.length,
        scope: context.bookId ?? '(全部)',
      })

      return {
        content,
        priority: this.priority,
        metadata: {
          source: 'database',
          buildTime: Date.now() - startTime,
          itemCount: relevantCards.length,
          method: 'relevance',
          previews: relevantCards.slice(0, 3).map((c) => ({
            title: c.title,
            snippet:
              (c.content ?? '').length > 60 ? (c.content ?? '').slice(0, 60) + '…' : c.content ?? '',
          })),
        },
      }
    } catch (error) {
      logger.error('Failed to build knowledge card context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'database',
          buildTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
}
