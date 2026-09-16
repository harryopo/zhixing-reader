/**
 * rag-service —— 书籍划线的本地检索（轻量 RAG）
 *
 * ## 这个文件原来在做什么（以及为什么被重写）
 * 原来这里有两套检索：向量语义检索（Vectra + embeddings API）与关键词检索兜底。
 * 2026-09-16 实测结论：**语义这条路在本机从来没通**（服务商没有 /embeddings 接口，
 * 向量索引 79 字节、0 条向量），而兜底的关键词检索中文切词是坏的（整句当一个词）——
 * 于是每次中文提问都检索到 0 条，AI 带着空上下文回答用户关于书的问题，
 * 日志里还写着 "Using RAG semantic search"，从外面完全看不出来。
 *
 * 现在只剩一条路：本地 BM25（src/shared/retrieval.ts）。它不需要任何 API、不会失败、
 * 也没有「索引还没建」的中间状态。这个文件只做三件事：
 *   1. 从数据库把划线读出来（含书名）
 *   2. 按签名缓存倒排索引，数据变了自动重建
 *   3. 把查询交给纯函数，返回带 highlightId 的结果（渲染层据此显示「引用来源」）
 */

import { getRepositories } from '../repositories'
import { highlightsDb } from '../database'
import { logger } from '../logger'
import { buildIndex, searchIndex, type RetrievalHit, type RetrievalIndex } from '../../src/shared/retrieval'

export type { RetrievalHit }

/** 缓存的索引 + 它对应的数据签名 */
let cached: { index: RetrievalIndex; signature: string } | null = null

/** 手动失效（测试与数据修复后调用；正常情况靠签名自动失效） */
export function invalidateRetrievalIndex(): void {
  cached = null
}

/** 取当前索引；签名变了就重建 */
function getIndex(): RetrievalIndex {
  const signature = highlightsDb.getRetrievalSignature()
  if (cached && cached.signature === signature) return cached.index

  const docs = getRepositories().highlights.findAll().map((h) => ({
    id: h.id,
    bookId: h.bookId,
    bookTitle: h.bookTitle ?? '',
    chapterTitle: h.chapterTitle,
    content: h.content,
  }))

  const index = buildIndex(docs)
  cached = { index, signature }
  logger.info('检索索引已重建', { docs: index.docCount, signature })
  return index
}

/**
 * 检索与问题最相关的划线。
 *
 * @param query   用户的问题（中文按 bigram 切）
 * @param options bookId 限定某本书；不传则跨书检索；limit 默认 5
 */
export async function retrieveHighlights(
  query: string,
  options: { bookId?: string; limit?: number } = {},
): Promise<RetrievalHit[]> {
  try {
    const index = getIndex()
    const hits = searchIndex(index, query, { limit: options.limit ?? 5, bookId: options.bookId })
    logger.info('本地检索', {
      query: query.slice(0, 50),
      bookId: options.bookId ?? '(全部)',
      results: hits.length,
      topScore: hits[0]?.relevanceScore,
    })
    return hits
  } catch (error) {
    // 检索失败不该让整轮对话崩掉：返回空上下文，但必须留日志
    logger.error('本地检索失败，本轮不带书籍上下文', { error: String(error) })
    return []
  }
}
