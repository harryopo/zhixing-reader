import { QdrantClient } from '@qdrant/js-client-rest'
import { logger } from '../logger'

const COLLECTION_NAME = 'book_highlights'
const VECTOR_SIZE = 1536 // OpenAI text-embedding-3-small 维度

let client: QdrantClient | null = null

interface VectorPoint {
  id: string
  vector: number[]
  payload: {
    bookId: string
    bookTitle: string
    highlightId: string
    content: string
    chapterTitle?: string
    createdAt: string
  }
}

interface SearchResult {
  id: string
  score: number
  payload: VectorPoint['payload']
}

// 初始化Qdrant客户端
export function initVectorDb(url: string = 'http://localhost:6333'): void {
  try {
    client = new QdrantClient({ url })
    logger.info(`Vector DB client initialized: ${url}`)
  } catch (error) {
    logger.error('Failed to initialize Vector DB client', error)
    throw error
  }
}

// 获取客户端实例
function getClient(): QdrantClient {
  if (!client) {
    throw new Error('Vector DB not initialized. Call initVectorDb() first.')
  }
  return client
}

// 创建集合
export async function createCollection(): Promise<void> {
  try {
    const qdrant = getClient()
    
    // 检查集合是否存在
    const collections = await qdrant.getCollections()
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME)
    
    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
        optimizers_config: {
          indexing_threshold: 20000,
        },
      })
      logger.info(`Collection '${COLLECTION_NAME}' created`)
    } else {
      logger.info(`Collection '${COLLECTION_NAME}' already exists`)
    }
  } catch (error) {
    logger.error('Failed to create collection', error)
    throw error
  }
}

// 插入向量点
export async function upsertPoints(points: VectorPoint[]): Promise<void> {
  try {
    const qdrant = getClient()
    
    const formattedPoints = points.map(p => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    }))
    
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: formattedPoints,
    })
    
    logger.info(`Upserted ${points.length} points to vector DB`)
  } catch (error) {
    logger.error('Failed to upsert points', error)
    throw error
  }
}

// 搜索相似向量
export async function searchSimilar(
  vector: number[],
  limit: number = 5,
  bookId?: string
): Promise<SearchResult[]> {
  try {
    const qdrant = getClient()
    
    const filter = bookId ? {
      must: [
        {
          key: 'bookId',
          match: { value: bookId },
        },
      ],
    } : undefined
    
    const results = await qdrant.search(COLLECTION_NAME, {
      vector,
      limit,
      filter,
      with_payload: true,
      score_threshold: 0.7, // 相似度阈值
    })
    
    return results.map(r => ({
      id: r.id as string,
      score: r.score,
      payload: r.payload as VectorPoint['payload'],
    }))
  } catch (error) {
    logger.error('Failed to search similar vectors', error)
    throw error
  }
}

// 删除指定书籍的向量
export async function deleteByBookId(bookId: string): Promise<void> {
  try {
    const qdrant = getClient()
    
    await qdrant.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: 'bookId',
            match: { value: bookId },
          },
        ],
      },
    })
    
    logger.info(`Deleted vectors for book: ${bookId}`)
  } catch (error) {
    logger.error('Failed to delete vectors', error)
    throw error
  }
}

// 删除指定highlight的向量
export async function deleteByHighlightId(highlightId: string): Promise<void> {
  try {
    const qdrant = getClient()
    
    await qdrant.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: 'highlightId',
            match: { value: highlightId },
          },
        ],
      },
    })
    
    logger.info(`Deleted vector for highlight: ${highlightId}`)
  } catch (error) {
    logger.error('Failed to delete vector', error)
    throw error
  }
}

// 获取集合统计信息
export async function getCollectionStats(): Promise<{ pointsCount: number }> {
  try {
    const qdrant = getClient()
    const info = await qdrant.getCollection(COLLECTION_NAME)
    return {
      pointsCount: info.points_count || 0,
    }
  } catch (error) {
    logger.error('Failed to get collection stats', error)
    throw error
  }
}

// 检查连接状态
export async function checkConnection(): Promise<boolean> {
  try {
    const qdrant = getClient()
    await qdrant.getCollections()
    return true
  } catch (error) {
    logger.error('Vector DB connection check failed', error)
    return false
  }
}
