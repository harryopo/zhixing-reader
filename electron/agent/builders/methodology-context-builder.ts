import { logger } from '../../logger'
import { methodologiesDb } from '../../database'
import { buildIndex, searchIndex, type RetrievalDoc } from '../../../src/shared/retrieval'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * methodologies 表读出来的行（rowsToObjects 保留数据库列名，即 snake_case）
 *
 * `id` 与 `name` 是库里声明的 `PRIMARY KEY` / `NOT NULL`，所以这里不写成可选 ——
 * 原先那句"没有 id 就按行号编一个"的兜底永远走不到（没有 id 的行建不出这一行），
 * 留着就是 `admin.ts` 那批清掉的聚合兜底同一种死分支。
 */
type MethodologyRow = {
  id: string
  /** 列是 NOT NULL + 外键，所以两条读路交回来的一定是字符串 */
  book_id: string
  /** 由 database/methodologies.ts 那条 JOIN 带出来（两条读路形状一样） */
  book_title?: string
  name: string
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
 *
 * 字段清单与「搜索页 / 方法论页」那两台筛选器同批（`src/shared/page-filter.ts` 的
 * `methodologySearchFields`）：名字、英文名、触发场景、说明、步骤、输出格式、示例、书名。
 * 原先这里少了 **输出格式** 与 **书名**（`bookTitle` 干脆写死成空串），于是同一个关键词
 * 搜索页说命中、AI 却说没有相关方法论 —— 三台筛选器两种答法，谁都不报错。
 */
function toDocs(items: MethodologyRow[]): { docs: RetrievalDoc[]; byId: Map<string, MethodologyRow> } {
  const byId = new Map<string, MethodologyRow>()
  const docs = items.map((m) => {
    byId.set(m.id, m)
    return {
      id: m.id,
      bookId: m.book_id,
      bookTitle: m.book_title ?? '',
      chapterTitle: m.name,
      content: [
        m.name,
        m.name_en,
        m.trigger_scenario,
        m.description,
        m.steps,
        m.output_format,
        m.examples,
      ]
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
 *
 * 2026-09-29 又补两处同层缺陷（都是"这一路检索的字段清单与界面那两台不一致"）：
 *   3. **书名不参与打分**：`bookTitle` 被写死成空串，于是问「《被讨厌的勇气》里那条方法论」
 *      时这一路一条都检索不到，而搜索页与方法论页都能按书名筛到同一条。
 *   4. **输出格式既不搜也不摆**：`output_format` 是 AI 提取时专门产出、提示词模板也在用的
 *      字段（"这个方法论产出什么"），注入给模型的文本里却完全没有它。
 *   顺带：注入文本给每条带上《书名》，没选书时写明范围（与划线那一路同一写法）。
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
          const parts = ['【' + m.name + '】' + (m.name_en ? ' (' + m.name_en + ')' : '')]
          if (m.book_title) parts.push('来源:《' + m.book_title + '》')
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
          if (m.output_format) parts.push('输出格式: ' + m.output_format)
          if (m.examples) parts.push('示例: ' + m.examples)
          if (m.mastery_level && m.mastery_level > 0) {
            parts.push('掌握度: ' + m.mastery_level + '%')
          }
          return parts.join('\n')
        })
        .join('\n\n---\n\n')

      // 没选书时是跨书检索：说清这批的范围，让模型知道不相关可以忽略（与划线那一路同一写法）
      const scopeHint = context.bookId
        ? ''
        : '\n（以上是从你的全部书籍的方法论中检索出来的，与当前问题无关就忽略）'

      const content =
        '\n\n## 用户已提取的方法论\n' +
        methodTexts +
        '\n\n当用户提问时，优先参考这些方法论来回答。如果用户的问题与某个方法论相关，请引用该方法论并给出具体指导。' +
        scopeHint

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
