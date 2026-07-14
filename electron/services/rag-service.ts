import { logger } from '../logger'
import { getRepositories } from '../repositories'
import { generateEmbedding, generateBatchEmbeddings } from './embedding-service'
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

// TF-IDF-like keyword search as fallback when RAG is unavailable
export function keywordSearch(
  query: string,
  bookId: string,
  limit: number = 5
): SearchResult[] {
  const repos = getRepositories()
  const highlights = repos.highlights.findByBookId(bookId)

  if (highlights.length === 0) return []

  const queryTerms = query.toLowerCase()
    .split(/[\s,，。？?！!、]+/)
    .filter(t => t.length > 1)

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
  } catch (error) {
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
  try {
    await getCollectionStats()
    return true
  } catch {
    return false
  }
}
