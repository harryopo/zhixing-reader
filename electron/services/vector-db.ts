import { app } from 'electron'
import * as path from 'path'
import { LocalIndex, MetadataFilter, IndexItem } from 'vectra'
import { logger } from '../logger'

/**
 * 本地向量数据库（基于 Vectra 0.15 LocalIndex）
 *
 * 设计说明：
 * - 替换原 Qdrant localhost 实现（打包后失效问题）
 * - Vectra 是纯 TypeScript 文件存储，零 native 依赖，Electron 打包零风险
 * - 索引文件落盘到 userData/vectra-index/
 * - embedding 仍由 embedding-service.ts 生成（OpenAI API）
 * - Vectra LocalIndex 内置 BM25 混合搜索（queryItems 第 5 参数 isBm25=true）
 */

const INDEX_FOLDER_NAME = 'vectra-index'

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

let index: LocalIndex | null = null
let initPromise: Promise<void> | null = null

/**
 * 初始化本地向量索引
 * @remarks 幂等：多次调用返回同一个 Promise
 */
export function initVectorDb(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = doInit().catch(err => {
    initPromise = null
    throw err
  })
  return initPromise
}

async function doInit(): Promise<void> {
  try {
    const indexPath = path.join(app.getPath('userData'), INDEX_FOLDER_NAME)
    index = new LocalIndex(indexPath)

    if (!(await index.isIndexCreated())) {
      await index.createIndex({
        version: 1,
        metadata_config: {
          indexed: ['bookId', 'highlightId'],
        },
      })
      logger.info(`Vectra index created`, { path: indexPath })
    } else {
      logger.info(`Vectra index loaded`, { path: indexPath })
    }
  } catch (error) {
    logger.error('Failed to initialize Vectra index', error)
    throw error
  }
}

function getIndex(): LocalIndex {
  if (!index) {
    throw new Error('Vector DB not initialized. Call initVectorDb() first.')
  }
  return index
}

/**
 * 创建集合（Vectra 中等同于 initVectorDb 已做的事，保留 API 兼容性）
 */
export async function createCollection(): Promise<void> {
  await initVectorDb()
}

/**
 * 插入或更新向量点
 * @remarks Vectra 不支持批量 upsert 单次调用，循环 upsertItem 即可
 */
export async function upsertPoints(points: VectorPoint[]): Promise<void> {
  const localIndex = getIndex()

  await localIndex.beginUpdate()
  try {
    for (const p of points) {
      await localIndex.upsertItem({
        id: p.id,
        vector: p.vector,
        metadata: p.payload,
      })
    }
    await localIndex.endUpdate()
    logger.info(`Upserted ${points.length} points to Vectra`)
  } catch (error) {
    try {
      localIndex.cancelUpdate()
    } catch {
      // ignore cancel errors
    }
    throw error
  }
}

/**
 * 搜索相似向量
 * @param queryVector 查询向量
 * @param limit 返回条数上限
 * @param bookId 可选，按书籍 ID 过滤
 */
export async function searchSimilar(
  queryVector: number[],
  limit: number = 5,
  bookId?: string
): Promise<SearchResult[]> {
  const localIndex = getIndex()

  const filter: MetadataFilter | undefined = bookId
    ? { bookId: { $eq: bookId } }
    : undefined

  // 第 5 参数 isBm25=true 启用 BM25 混合搜索
  // 注意：Vectra queryItems 需要 query 字符串做 BM25，但 BM25 需要 docReader 或 metadata.content
  // 这里 query 留空，关闭 BM25（避免依赖额外配置），仅用 cosine 相似度
  const results = await localIndex.queryItems(queryVector, '', limit, filter, false)

  return results.map(r => ({
    id: r.item.id,
    score: r.score,
    payload: r.item.metadata as VectorPoint['payload'],
  }))
}

/**
 * 删除指定书籍的所有向量
 */
export async function deleteByBookId(bookId: string): Promise<void> {
  const localIndex = getIndex()
  const filter: MetadataFilter = { bookId: { $eq: bookId } }
  const items = await localIndex.listItemsByMetadata(filter)

  if (items.length === 0) {
    logger.info(`No vectors to delete for book: ${bookId}`)
    return
  }

  await localIndex.beginUpdate()
  try {
    await localIndex.deleteItems(items.map(i => i.id))
    await localIndex.endUpdate()
    logger.info(`Deleted ${items.length} vectors for book: ${bookId}`)
  } catch (error) {
    try {
      localIndex.cancelUpdate()
    } catch {
      // ignore
    }
    throw error
  }
}

/**
 * 删除指定 highlight 的向量
 */
export async function deleteByHighlightId(highlightId: string): Promise<void> {
  const localIndex = getIndex()
  const filter: MetadataFilter = { highlightId: { $eq: highlightId } }
  const items = await localIndex.listItemsByMetadata(filter)

  if (items.length === 0) {
    logger.info(`No vector to delete for highlight: ${highlightId}`)
    return
  }

  await localIndex.beginUpdate()
  try {
    await localIndex.deleteItems(items.map(i => i.id))
    await localIndex.endUpdate()
    logger.info(`Deleted vector for highlight: ${highlightId}`)
  } catch (error) {
    try {
      localIndex.cancelUpdate()
    } catch {
      // ignore
    }
    throw error
  }
}

/**
 * 获取集合统计信息
 */
export async function getCollectionStats(): Promise<{ pointsCount: number }> {
  const localIndex = getIndex()
  const stats = await localIndex.getIndexStats()
  return { pointsCount: stats.items }
}

/**
 * 检查连接状态（Vectra 是本地文件，永远可用）
 */
export async function checkConnection(): Promise<boolean> {
  try {
    getIndex()
    return true
  } catch {
    return false
  }
}

/**
 * 获取所有项（用于调试 / 迁移）
 */
export async function listAllItems(): Promise<IndexItem[]> {
  const localIndex = getIndex()
  return localIndex.listItems()
}
