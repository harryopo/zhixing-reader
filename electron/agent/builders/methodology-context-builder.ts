import { logger } from '../../logger'
import { methodologiesDb } from '../../database'
import { buildIndex, searchIndex, type RetrievalDoc } from '../../../src/shared/retrieval'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/** methodologies 表读出来的行（rowsToObjects 保留数据库列名，即 snake_case） */
type MethodologyRow = {
  id?: string
  book_id?: string
  name?: string
  name_en?: string
  trigger_scenario?: string
  description?: string
  steps?: string
  output_format?: string
  examples?: string
  mastery_level?: number
}

/**
 * 把方法论行转成检索文档，并留下 id -> 行 的索引（命中后要拿回原行渲染）
 */
function toDocs(items: MethodologyRow[]): { docs: RetrievalDoc[]; byId: Map<string, MethodologyRow> } {
  const byId = new Map<string, MethodologyRow>()
  const docs = items.map((m, index) => {
    const id = m.id ?? 'methodology_' + index
    byId.set(id, m)
    return {
      id,
      bookId: m.book_id ?? '',
      bookTitle: '',
      chapterTitle: m.name,
      content: [m.name, m.name_en, m.trigger_scenario, m.description, m.steps, m.examples]
        .filter(Boolean)
        .join('\n'),
    }
  })
  return { docs, byId }
}

/**
 * 方法论上下文构建器
 *
 * 2026-09-16 两处修正（与知识卡片同一类问题）：
 *   1. **不再要求先关联书籍**：首页进来的对话默认没选书，原来这一路被整段跳过，
 *      AI 完全拿不到用户自己提取的方法论。现在没选书就跨全部方法论检索。
 *   2. **打分改用与划线检索同一套中文分词（BM25）**：原来是拿用户整句去
 *      `includes(...)`，中文没有空格 → 几乎永远为 false → 「相关方法论」实际按数据库
 *      顺序取前 5 条注入。现在只注入真正命中的；一条都没命中就不注入。
 */
export class MethodologyContextBuilder implements ContextBuilder {
  name = 'methodology'
  priority = 80

  shouldBuild(_context: BuildContext): boolean {
    return true
  }

  build(context: BuildContext): ContextBuildResult {
    const startTime = Date.now()

    try {
      const methodologies = (
        context.bookId ? methodologiesDb.getByBookId(context.bookId) : methodologiesDb.getAll()
      ) as MethodologyRow[]

      if (methodologies.length === 0) {
        return {
          content: '',
          priority: this.priority,
          metadata: { source: 'database', buildTime: Date.now() - startTime, itemCount: 0, method: 'relevance' },
        }
      }

      const { docs, byId } = toDocs(methodologies)
      const hits = searchIndex(buildIndex(docs), context.userMessage, { limit: 5 })
      const relevantMethodologies = hits
        .map((hit) => byId.get(hit.highlightId)) // 注意：searchIndex 把 doc.id 改名成 highlightId 返回
        .filter((m): m is MethodologyRow => !!m)

      if (relevantMethodologies.length === 0) {
        return {
          content: '',
          priority: this.priority,
          metadata: { source: 'database', buildTime: Date.now() - startTime, itemCount: 0, method: 'relevance' },
        }
      }

      const methodTexts = relevantMethodologies
        .map((m) => {
          const parts = ['【' + (m.name ?? '') + '】' + (m.name_en ? ' (' + m.name_en + ')' : '')]
          if (m.trigger_scenario) parts.push('触发场景: ' + m.trigger_scenario)
          if (m.description) parts.push('描述: ' + m.description)
          if (m.steps) {
            try {
              const steps = JSON.parse(m.steps)
              if (Array.isArray(steps) && steps.length > 0) {
                parts.push('步骤: ' + steps.join(' → '))
              }
            } catch {
              /* 步骤不是合法 JSON 数组时跳过，不影响其余内容 */
            }
          }
          if (m.examples) parts.push('示例: ' + m.examples)
          if (m.mastery_level && m.mastery_level > 0) {
            parts.push('掌握度: ' + m.mastery_level + '%')
          }
          return parts.join('\n')
        })
        .join('\n\n---\n\n')

      const content =
        '\n\n## 用户已提取的方法论\n' +
        methodTexts +
        '\n\n当用户提问时，优先参考这些方法论来回答。如果用户的问题与某个方法论相关，请引用该方法论并给出具体指导。'

      logger.info('Methodology context loaded', {
        count: relevantMethodologies.length,
        total: methodologies.length,
        scope: context.bookId ?? '(全部)',
      })

      return {
        content,
        priority: this.priority,
        metadata: {
          source: 'database',
          buildTime: Date.now() - startTime,
          itemCount: relevantMethodologies.length,
          method: 'relevance',
          previews: relevantMethodologies.slice(0, 3).map((m) => ({
            title: m.name,
            snippet:
              (m.description ?? '').length > 60
                ? (m.description ?? '').slice(0, 60) + '…'
                : m.description ?? '',
          })),
        },
      }
    } catch (error) {
      logger.error('Failed to build methodology context', error)
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
