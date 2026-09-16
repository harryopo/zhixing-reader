import { logger } from '../logger'
import { getRepositories } from '../repositories'
import { generateEmbedding, generateBatchEmbeddings, isEmbeddingUnavailable } from './embedding-service'
import { searchSimilar, upsertPoints, deleteByHighlightId, getCollectionStats } from './vector-db'

interface HighlightForIndexing {
  id: string
  bookId: string
  bookTitle: string
  content: string
  chapterTitle?: string
  createdAt: string
}

interface SearchResult {
  highlightId: string
  bookId: string
  bookTitle: string
  content: string
  chapterTitle?: string
  relevanceScore: number
}

export async function indexHighlight(highlight: HighlightForIndexing): Promise<void> {
  try {
    const vector = await generateEmbedding(highlight.content)

    await upsertPoints([{
      id: `highlight_${highlight.id}`,
      vector,
      payload: {
        bookId: highlight.bookId,
        bookTitle: highlight.bookTitle,
        highlightId: highlight.id,
        content: highlight.content,
        chapterTitle: highlight.chapterTitle,
        createdAt: highlight.createdAt,
      },
    }])

    logger.info(`Indexed highlight: ${highlight.id}`)
  } catch (error) {
    logger.error(`Failed to index highlight: ${highlight.id}`, error)
  }
}

export async function indexHighlightsBatch(highlights: HighlightForIndexing[]): Promise<void> {
  if (highlights.length === 0) return

  try {
    const texts = highlights.map(h => h.content)
    const vectors = await generateBatchEmbeddings(texts)

    const points = highlights.map((h, i) => ({
      id: `highlight_${h.id}`,
      vector: vectors[i],
      payload: {
        bookId: h.bookId,
        bookTitle: h.bookTitle,
        highlightId: h.id,
        content: h.content,
        chapterTitle: h.chapterTitle,
        createdAt: h.createdAt,
      },
    }))

    await upsertPoints(points)
    logger.info(`Batch indexed ${highlights.length} highlights`)
  } catch (error) {
    logger.error('Failed to batch index highlights', error)
  }
}

export async function semanticSearch(
  query: string,
  options: {
    limit?: number
    bookId?: string
  } = {}
): Promise<SearchResult[]> {
  const { limit = 5, bookId } = options

  const queryVector = await generateEmbedding(query)
  const results = await searchSimilar(queryVector, limit, bookId)

  return results.map(r => ({
    highlightId: r.payload.highlightId,
    bookId: r.payload.bookId,
    bookTitle: r.payload.bookTitle,
    content: r.payload.content,
    chapterTitle: r.payload.chapterTitle,
    relevanceScore: r.score,
  }))
}

/**
 * 把查询拆成可用于 includes 匹配的词。
 *
 * ## 为什么必须单独处理中文（2026-09-16 实测）
 * 原来的实现是 `query.split(/[\s,，。？?！!、]+/)` —— 对英文没问题，
 * 但**中文句子没有空格**，整句会变成一个"词"（例如「作者认为人际关系重要吗」），
 * 拿它去 `highlight.content.includes(整句)` 几乎永远为 false，
 * 结果就是：**每次中文提问，关键词检索都返回空**，AI 拿到零条书籍上下文。
 * （这也解释了为什么用户 38 条对话的「引用来源」一直是 0 条。）
 *
 * 修法：含中文的词按 **2 字滑窗** 展开成 bigram（"人际关系" → 人际/际关/关系），
 * 英文词保持原样。bigram 是中文检索里最省事又够用的做法，
 * 稀有组合会被后面的 IDF 自动加权，常见组合自然沉底。
 */
export function expandQueryTerms(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[\s,，。？?！!、；;：:""''（）()【】]+/)
    .filter((t) => t.length > 0)

  const out = new Set<string>()
  for (const term of raw) {
    if (!/[\u4e00-\u9fa5]/.test(term)) {
      // 纯英文/数字：长度 1 的词没有检索价值（噪声太大）
      if (term.length > 1) out.add(term)
      continue
    }
    const chars = [...term]
    if (chars.length <= 2) {
      out.add(term)
      continue
    }
    for (let i = 0; i + 1 < chars.length; i++) {
      out.add(chars[i] + chars[i + 1])
    }
  }
  return [...out]
}

// TF-IDF-like keyword search as fallback when RAG is unavailable
export function keywordSearch(
  query: string,
  bookId: string,
  limit: number = 5
): SearchResult[] {
  const repos = getRepositories()
  const highlights = repos.highlights.findByBookId(bookId)

  if (highlights.length === 0) return []

  const queryTerms = expandQueryTerms(query)

  if (queryTerms.length === 0) {
    return highlights.slice(0, limit).map(h => ({
      highlightId: h.id,
      bookId: h.bookId,
      bookTitle: h.bookTitle || '',
      content: h.content,
      chapterTitle: h.chapterTitle,
      relevanceScore: 0.1,
    }))
  }

  // Calculate IDF-like weights (rarer terms get higher weight)
  const docCount = highlights.length
  const termDocCount = new Map<string, number>()

  for (const highlight of highlights) {
    const text = highlight.content.toLowerCase()
    const uniqueTerms = new Set(queryTerms.filter(t => text.includes(t)))
    for (const term of uniqueTerms) {
      termDocCount.set(term, (termDocCount.get(term) || 0) + 1)
    }
  }

  const scored = highlights.map(highlight => {
    const text = highlight.content.toLowerCase()
    let score = 0

    for (const term of queryTerms) {
      if (!text.includes(term)) continue

      // Term frequency (capped at 3)
      const tf = Math.min(3, (text.split(term).length - 1))

      // Inverse document frequency
      const docFreq = termDocCount.get(term) || 1
      const idf = Math.log(docCount / docFreq) + 1

      score += tf * idf
    }

    // Boost for exact phrase match
    const queryLower = query.toLowerCase()
    if (text.includes(queryLower)) {
      score *= 2
    }

    return { highlight, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => ({
      highlightId: s.highlight.id,
      bookId: s.highlight.bookId,
      bookTitle: s.highlight.bookTitle || '',
      content: s.highlight.content,
      chapterTitle: s.highlight.chapterTitle,
      relevanceScore: s.score,
    }))
}

export async function removeHighlightIndex(highlightId: string): Promise<void> {
  try {
    await deleteByHighlightId(highlightId)
    logger.info(`Removed vector index for highlight: ${highlightId}`)
  } catch (error) {
    logger.error(`Failed to remove vector index for highlight: ${highlightId}`, error)
  }
}

export async function getRAGStats(): Promise<{
  vectorCount: number
  isAvailable: boolean
}> {
  try {
    const stats = await getCollectionStats()
    return {
      vectorCount: stats.pointsCount,
      isAvailable: true,
    }
  } catch (_error) {
    return {
      vectorCount: 0,
      isAvailable: false,
    }
  }
}

export async function rebuildIndex(): Promise<{ indexed: number; errors: number }> {
  let indexed = 0
  let errors = 0

  try {
    logger.info('Starting full index rebuild...')

    const repos = getRepositories()
    const allHighlights = repos.highlights.findAll()
    logger.info(`Found ${allHighlights.length} highlights to index`)

    const batchSize = 50
    for (let i = 0; i < allHighlights.length; i += batchSize) {
      const batch = allHighlights.slice(i, i + batchSize)

      const highlightsForIndexing: HighlightForIndexing[] = batch.map(h => ({
        id: h.id,
        bookId: h.bookId,
        bookTitle: h.bookTitle || 'Unknown',
        content: h.content,
        chapterTitle: h.chapterTitle,
        createdAt: h.createdAt || new Date().toISOString(),
      }))

      try {
        await indexHighlightsBatch(highlightsForIndexing)
        indexed += highlightsForIndexing.length
      } catch (error) {
        errors += highlightsForIndexing.length
        logger.error(`Failed to index batch at index ${i}`, error)
      }
    }

    logger.info(`Index rebuild complete: ${indexed} indexed, ${errors} errors`)
    return { indexed, errors }
  } catch (error) {
    logger.error('Failed to rebuild index', error)
    throw error
  }
}

export async function checkRAGAvailability(): Promise<boolean> {
  // Embedding 端点已确认不可用时直接判否，交由调用方走关键词检索，
  // 不再让每次对话都白等一次注定失败的 /embeddings 请求。
  if (isEmbeddingUnavailable()) return false
  try {
    // 2026-09-16：**必须确认索引里真的有向量**。
    // 原来只要索引文件能打开就返回 true —— 实测用户本机索引是空的（79 字节、0 条向量），
    // 于是每次都判定"可用"、走语义检索、拿到空结果，然后**不会回退到关键词检索**，
    // AI 就带着零条书籍上下文回答问题，日志里还写着 Using RAG semantic search。
    const stats = await getCollectionStats()
    if (stats.pointsCount === 0) {
      if (!warnedEmptyIndex) {
        warnedEmptyIndex = true
        logger.warn('向量索引为空（0 条向量）：语义检索不可用，本次对话将使用关键词检索。索引只在「新建划线」时写入，微信读书导入的划线从未被索引。')
      }
      return false
    }
    return true
  } catch {
    return false
  }
}

/** 空索引只提醒一次，避免每次对话都刷日志 */
let warnedEmptyIndex = false
