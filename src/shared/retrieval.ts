/**
 * 本地词法检索（轻量 RAG）—— 纯函数，零依赖、零网络。
 *
 * ## 为什么不用向量语义检索（2026-09-16 实测）
 * 用户的 AI 服务商（DeepSeek）**没有 /embeddings 接口**，向量这条路在本机永远走不通：
 * 日志里是 "Failed to generate embedding"，向量索引目录只有 79 字节（0 条向量）。
 * 它还有两个隐藏代价：vectra 0.15 带来 13 个直接依赖 / 约 50 个传递依赖；
 * 索引只在「手动新建划线」时写入，微信读书导入的 934 条划线从未被索引 ——
 * 所以「语义检索」从来没有真正工作过，而它的失败是**静默的**。
 *
 * 这里用最朴素也最可靠的办法：**BM25 + 倒排索引**。
 * 中文没有空格，所以按 **2 字滑窗（bigram）** 切；英文按词切。
 *
 * 实测（用户真实数据库 934 条划线）：四个日常中文问题
 *   旧切词（整句当一个词）命中 0 条；本模块的 bigram 命中 33~79 条。
 */

/** BM25 参数（经典取值，不需要调） */
const K1 = 1.2
const B = 0.75
/** 标题 / 章节名里的词额外算 3 次，让「章节名命中」排得更靠前 */
const TITLE_BOOST = 3
/** 出现在超过这个比例文档里的词视为噪声（「什么」「这个」这类 bigram），不参与打分 */
const MAX_DOC_FREQ_RATIO = 0.5
/** 只保留得分达到最高分 20% 以上的结果，避免擦边命中污染上下文 */
const DEFAULT_RELATIVE_CUTOFF = 0.2

export interface RetrievalDoc {
  id: string
  bookId: string
  bookTitle: string
  chapterTitle?: string
  content: string
}

export interface Posting {
  /** 在 index.docs 里的下标 */
  doc: number
  /** 该词在这篇文档里的出现次数（含标题加权） */
  tf: number
}

export interface RetrievalIndex {
  docs: RetrievalDoc[]
  postings: Map<string, Posting[]>
  docFreq: Map<string, number>
  docLengths: number[]
  avgDocLength: number
  docCount: number
}

export interface RetrievalHit {
  highlightId: string
  bookId: string
  bookTitle: string
  chapterTitle?: string
  content: string
  relevanceScore: number
}

/** 英文 / 数字词；单字符丢弃（噪声太大） */
const ASCII_WORD = /[a-z0-9][a-z0-9_-]*/g

/**
 * 切词：中文 2 字滑窗 + 英文整词。
 *
 * 中文没有空格，整句当「一个词」去匹配几乎永远命中不了 —— 这正是修复前的 bug：
 * 用户问「作者认为人际关系重要吗」，切出来是这一整句，然后拿它去
 * highlight.content.includes(整句)，结果永远为 false。
 */
export function tokenize(text: string): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const tokens: string[] = []

  for (const m of lower.matchAll(ASCII_WORD)) {
    if (m[0].length > 1) tokens.push(m[0])
  }

  const cjkRuns = lower.match(/[\u4e00-\u9fa5]+/g) ?? []
  for (const run of cjkRuns) {
    const chars = [...run]
    if (chars.length === 1) {
      tokens.push(chars[0])
      continue
    }
    for (let i = 0; i + 1 < chars.length; i++) {
      tokens.push(chars[i] + chars[i + 1])
    }
  }

  return tokens
}

/** 建索引：把文档列表转成倒排表 */
export function buildIndex(docs: RetrievalDoc[]): RetrievalIndex {
  const postings = new Map<string, Posting[]>()
  const docLengths: number[] = []

  docs.forEach((doc, docIndex) => {
    const tfMap = new Map<string, number>()
    const add = (token: string, weight: number) => {
      tfMap.set(token, (tfMap.get(token) ?? 0) + weight)
    }

    const bodyTokens = tokenize(doc.content)
    for (const t of bodyTokens) add(t, 1)
    // 章节名与书名只加权，不计入文档长度
    for (const t of tokenize(doc.chapterTitle ?? '')) add(t, TITLE_BOOST)
    for (const t of tokenize(doc.bookTitle)) add(t, TITLE_BOOST)

    docLengths.push(bodyTokens.length)
    for (const [token, tf] of tfMap) {
      const list = postings.get(token)
      if (list) list.push({ doc: docIndex, tf })
      else postings.set(token, [{ doc: docIndex, tf }])
    }
  })

  const docFreq = new Map<string, number>()
  for (const [token, list] of postings) docFreq.set(token, list.length)

  const totalLength = docLengths.reduce((s, n) => s + n, 0)
  return {
    docs,
    postings,
    docFreq,
    docLengths,
    avgDocLength: docs.length > 0 ? totalLength / docs.length : 0,
    docCount: docs.length,
  }
}

/**
 * 检索。
 *
 * 打分 = Σ BM25(每个查询词)，IDF 用标准 BM25 平滑公式；
 * 最后按「相对最高分」截断 —— 这样不需要为不同语料手工调一个绝对阈值。
 */
export function searchIndex(
  index: RetrievalIndex,
  query: string,
  options: { limit?: number; bookId?: string; relativeCutoff?: number } = {},
): RetrievalHit[] {
  const { limit = 5, bookId, relativeCutoff = DEFAULT_RELATIVE_CUTOFF } = options
  if (index.docCount === 0) return []

  const uniqueTerms = [...new Set(tokenize(query))].filter((term) => {
    const df = index.docFreq.get(term) ?? 0
    if (df === 0) return false
    // 人人都有的词不构成区分度（「什么」「这个」这类 bigram 在这一层被丢掉）
    return df / index.docCount <= MAX_DOC_FREQ_RATIO
  })
  if (uniqueTerms.length === 0) return []

  const scores = new Map<number, number>()
  for (const term of uniqueTerms) {
    const df = index.docFreq.get(term) ?? 0
    const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5))
    for (const posting of index.postings.get(term) ?? []) {
      const docLength = index.docLengths[posting.doc] || index.avgDocLength || 1
      const denom = posting.tf + K1 * (1 - B + (B * docLength) / (index.avgDocLength || 1))
      const score = idf * ((posting.tf * (K1 + 1)) / denom)
      scores.set(posting.doc, (scores.get(posting.doc) ?? 0) + score)
    }
  }

  const ranked = [...scores.entries()]
    .filter(([docIndex]) => !bookId || index.docs[docIndex].bookId === bookId)
    .sort((a, b) => b[1] - a[1])
  if (ranked.length === 0) return []

  const top = ranked[0][1]
  return ranked
    .filter(([, score]) => score >= top * relativeCutoff)
    .slice(0, limit)
    .map(([docIndex, score]) => {
      const doc = index.docs[docIndex]
      return {
        highlightId: doc.id,
        bookId: doc.bookId,
        bookTitle: doc.bookTitle,
        chapterTitle: doc.chapterTitle,
        content: doc.content,
        relevanceScore: Number(score.toFixed(4)),
      }
    })
}
