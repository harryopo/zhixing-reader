import { logger } from '../../logger'
import { vocabularyDb } from '../../database'
import { buildIndex, searchIndex, type RetrievalDoc } from '../../../src/shared/retrieval'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/** vocabulary 表读出来的行（rowsToObjects 保留数据库列名，即 snake_case） */
type WordRow = {
  id?: string
  word?: string
  phonetic?: string
  part_of_speech?: string
  meaning_zh?: string
  example_en?: string
  example_zh?: string
  cefr_level?: string
  review_count?: number
  is_mastered?: number
}

/** 一次最多注入几个生词（词表命中通常成串，太多会挤掉笔记上下文） */
const MAX_WORDS = 8

function toDocs(items: WordRow[]): { docs: RetrievalDoc[]; byId: Map<string, WordRow> } {
  const byId = new Map<string, WordRow>()
  const docs = items.map((w, index) => {
    const id = w.id ?? 'word_' + index
    byId.set(id, w)
    return {
      id,
      bookId: '',
      bookTitle: '',
      chapterTitle: w.word,
      content: [w.word, w.meaning_zh, w.example_en, w.example_zh].filter(Boolean).join('\n'),
    }
  })
  return { docs, byId }
}

function render(w: WordRow): string {
  const head = `【${w.word ?? ''}】` + (w.phonetic ? ` ${w.phonetic}` : '')
  const parts = [head]
  const meaning = [w.part_of_speech, w.meaning_zh].filter(Boolean).join(' ')
  if (meaning) parts.push('释义: ' + meaning)
  if (w.example_en) parts.push('例句: ' + w.example_en + (w.example_zh ? '（' + w.example_zh + '）' : ''))
  if (w.cefr_level) parts.push('级别: ' + w.cefr_level)
  parts.push('复习过 ' + (w.review_count ?? 0) + ' 次' + (w.is_mastered ? '，已标记掌握' : ''))
  return parts.join('\n')
}

/**
 * 生词的上下文构建器
 *
 * 2026-09-24 新增：生词本存着词、释义、例句与复习状态，但提示词从来不带它。
 * 用户问「我最近学的词里有没有表示"犹豫"的」时 AI 完全看不见。
 * 与文章那一路同一套 BM25 检索；一条都没命中就不注入，不硬塞。
 */
export class VocabularyContextBuilder implements ContextBuilder {
  name = 'vocabulary'
  /** 低于书籍划线/卡片/方法论与文章：生词是最容易挤占预算的一路 */
  priority = 45

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
      const words = vocabularyDb.getAll(500) as WordRow[]
      if (words.length === 0) return empty(0)

      const { docs, byId } = toDocs(words)
      const hits = searchIndex(buildIndex(docs), context.userMessage, { limit: MAX_WORDS })
      const relevant = hits.map((hit) => byId.get(hit.highlightId)).filter((w): w is WordRow => !!w)
      if (relevant.length === 0) return empty(0)

      const body = relevant.map(render).join('\n')
      const content =
        '\n\n## 用户的生词本（命中的词）\n' +
        body +
        '\n\n这些是用户自己在收的词。需要举例或对比时优先用它们的原句；' +
        '与问题无关就忽略。'

      logger.info('Vocabulary context loaded', { count: relevant.length, total: words.length })

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
      logger.error('Failed to build vocabulary context', error)
      return empty(0)
    }
  }
}
