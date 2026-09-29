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
 * 现在只剩一条路：本地 BM25（src/shared/retrieval.ts）。它不需要任何 API，也没有
 * 「索引还没建」的中间状态；会失败的只有读库那一步，而那一步的失败**必须让调用方看见**
 * （见 retrieveHighlights 的注释）。这个文件只做三件事：
 *   1. 从数据库把划线读出来（含书名与用户自己写的想法 note）
 *   2. 按签名缓存倒排索引，数据变了自动重建
 *   3. 把查询交给纯函数，返回带 highlightId 的结果（渲染层据此显示「引用来源」）
 */

import { highlightsDb } from '../database'
import { logger } from '../logger'
import { buildIndex, searchIndex, type RetrievalHit, type RetrievalIndex } from '../../src/shared/retrieval'

export type { RetrievalHit }

/** 缓存的索引 + 它对应的数据签名 */
let cached: { index: RetrievalIndex; signature: string } | null = null

/**
 * 手动失效索引缓存。
 *
 * 生产里没有调用方：签名含写计数器（见 highlights.ts 的 writeRevision），
 * 任何走 highlightsDb 的增删改都会让它变化，索引自然重来。这个导出只服务测试的隔离，
 * 别再往"数据修复后调一下"的方向想 —— 那个承诺原来就没人兑现，也不需要兑现。
 */
export function invalidateRetrievalIndex(): void {
  cached = null
}

/**
 * 取当前索引；签名变了就重建
 *
 * 行形状的诚实声明：`content` 与 `book_title` 都来自 NOT NULL 列（后者还是 INNER JOIN
 * 出来的，书的行不在就整条不出现），所以原来那两处兜底是永远走不到的分支，已删。
 * `chapter_title` 与 `note` 是真可空列（DDL 没有 NOT NULL），null 归成 undefined ——
 * 与"空串"在这一层之后不再区分，因为渲染层用的是同一个真值判定（空串也不摆空方括号）。
 */
function getIndex(): RetrievalIndex {
  const signature = highlightsDb.getRetrievalSignature()
  if (cached && cached.signature === signature) return cached.index

  // getAll() 的 SQL 就把书名 JOIN 出来了（book_title）：整库划线一次读出来建索引，
  // 与旧的仓储层 findAll() 是同一条查询 —— 那一层已经因为"同一份查询写两遍"漂过一次
  const docs = highlightsDb.getAll().map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    bookTitle: String(row.book_title),
    chapterTitle: row.chapter_title == null ? undefined : String(row.chapter_title),
    content: String(row.content),
    note: row.note == null ? undefined : String(row.note),
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
 *
 * **失败一律往上抛，不在这里演成"没有命中"**：原来这层 `catch` 回空数组，于是读库炸了
 * 与"这个问题确实搜不到东西"交回的结果一字不差 —— 而唯一的调用方（书籍上下文构建器）
 * 自己有一层 catch 会把消息记进 `metadata.error`，对话面板据此才说得出「读取失败」。
 * 这一层吞掉，面板就只能对用户的数据库结构说一句假话（说「无命中」）。
 * 检索本身不崩对话：抛出去的那一条由调用方接住，本轮只是不带书籍上下文。
 */
export async function retrieveHighlights(
  query: string,
  options: { bookId?: string; limit?: number } = {},
): Promise<RetrievalHit[]> {
  const index = getIndex()
  const hits = searchIndex(index, query, { limit: options.limit ?? 5, bookId: options.bookId })
  logger.info('本地检索', {
    query: query.slice(0, 50),
    bookId: options.bookId ?? '(全部)',
    results: hits.length,
    topScore: hits[0]?.relevanceScore,
  })
  return hits
}
