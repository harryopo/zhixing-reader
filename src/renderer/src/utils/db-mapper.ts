import type { RagSourceRef } from '../../../shared/types'

export function safeNum(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

export function safeStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback
  return String(val)
}

/**
 * 库里的布尔列是 INTEGER 0/1（sql.js 读出来就是数字）。
 * 在边界处掰成真正的 boolean，别让类型说一套、值做一套。
 */
export function safeBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  return Number(val) === 1
}

/** 容错解析 DB 中的 JSON 数组字段（tags / steps）：损坏或非数组时回退空数组 */
export function safeJsonArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string' && val) {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** DB 中以 JSON 数组存放的字符串列表（tags / steps / 来源划线 id） */
export function safeStrArray(val: unknown): string[] {
  return safeJsonArray(val).map(String)
}

export function safeDate(val: unknown): string {
  if (!val) return ''
  try {
    const d = new Date(val as string | number)
    if (isNaN(d.getTime())) return ''
    return d.toISOString()
  } catch {
    return ''
  }
}

export function formatDate(val: unknown): string {
  if (!val) return '未知时间'
  try {
    const d = new Date(val as string | number)
    if (isNaN(d.getTime())) return '未知时间'
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '未知时间'
  }
}

export function formatDateShort(val: unknown): string {
  if (!val) return '-'
  try {
    const d = new Date(val as string | number)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return '-'
  }
}

export function formatTimeAgo(val: unknown): string {
  if (!val) return '-'
  try {
    const d = new Date(val as string | number)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}小时前`
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '-'
  }
}

/**
 * 映射器保证会写出的字段。其余下划线列原样透传（`...row`），
 * 靠索引签名兜住 —— 页面读透传列时得自己收窄，那是真在读原始列，不是类型在骗人。
 */
export interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  isbn: string
  publisher: string
  description: string
  category: string
  source: string
  progress: number
  isFinished: number
  totalChapter: number
  lastReadAt: string
  publishDate: string
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export type HighlightType = 'highlight' | 'note'

export interface HighlightRow {
  id: string
  bookId: string
  chapterTitle: string
  content: string
  note: string
  /** 由 note 是否非空推导，见 mapHighlight */
  type: HighlightType
  style: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface CardRow {
  id: string
  bookId: string
  highlightId: string
  nextReviewAt: string
  lastReviewAt: string
  /** FSRS 调度状态（cards 表真实列，掌握度由它推导；reps 即累计复习次数） */
  state: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  createdAt: string
  [key: string]: unknown
}

export type KnowledgeCardType = 'concept' | 'methodology' | 'quote'

export interface KnowledgeCardRow {
  id: string
  bookId: string
  type: KnowledgeCardType
  title: string
  content: string
  interpretation: string
  application: string
  relatedCardIds: string[]
  tags: string[]
  sourceHighlightId: string
  reviewCount: number
  masteryLevel: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface MethodologyRow {
  id: string
  bookId: string
  name: string
  nameEn: string
  triggerScenario: string
  description: string
  steps: string[]
  outputFormat: string
  examples: string
  tags: string[]
  sourceHighlightIds: string[]
  masteryLevel: number
  practiceCount: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export function mapBook(row: Record<string, unknown>): BookRow {
  return {
    ...row,
    id: safeStr(row.id),
    title: safeStr(row.title, '未知书名'),
    author: safeStr(row.author, '未知作者'),
    cover: safeStr(row.cover),
    isbn: safeStr(row.isbn),
    publisher: safeStr(row.publisher),
    description: safeStr(row.description),
    category: safeStr(row.category),
    source: safeStr(row.source),
    progress: safeNum(row.reading_progress ?? row.progress),
    // 库里只有 is_finished，界面历史上有两种写法，归一化后只留一份口径
    isFinished: safeNum(row.is_finished ?? row.isFinished),
    totalChapter: safeNum(row.total_chapter ?? row.totalChapter),
    lastReadAt: safeDate(row.last_read_time ?? row.lastReadAt),
    publishDate: safeDate(row.publish_date ?? row.publishDate),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapHighlight(row: Record<string, unknown>): HighlightRow {
  const note = safeStr(row.note)
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId),
    chapterTitle: safeStr(row.chapter_title ?? row.chapterTitle, '未知章节'),
    content: safeStr(row.content),
    note,
    // highlights 表没有类型列：微信读书的「想法」落地时只有 note 非空这一个信号
    // （content 存它引用的原文，note 存用户写的想法）。
    // 此前界面读的是不存在的 type 列，「笔记」页签和计数恒为 0。
    type: note ? 'note' : 'highlight',
    style: safeNum(row.style),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapCard(row: Record<string, unknown>): CardRow {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    highlightId: safeStr(row.highlight_id ?? row.highlightId),
    nextReviewAt: safeDate(row.due ?? row.nextReviewAt),
    lastReviewAt: safeDate(row.last_review ?? row.lastReviewAt),
    state: safeNum(row.state),
    stability: safeNum(row.stability),
    difficulty: safeNum(row.difficulty),
    reps: safeNum(row.reps),
    lapses: safeNum(row.lapses),
    createdAt: safeDate(row.created_at ?? row.createdAt),
  }
}

export function mapBooks(rows: unknown[]): BookRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapBook(r as Record<string, unknown>))
}

export function mapHighlights(rows: unknown[]): HighlightRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapHighlight(r as Record<string, unknown>))
}

export function mapCards(rows: unknown[]): CardRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapCard(r as Record<string, unknown>))
}

export function mapKnowledgeCard(row: Record<string, unknown>): KnowledgeCardRow {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    type: row.type as KnowledgeCardType,
    title: safeStr(row.title, '无标题'),
    content: safeStr(row.content),
    interpretation: safeStr(row.interpretation),
    application: safeStr(row.application),
    relatedCardIds: safeStrArray(row.related_card_ids ?? row.relatedCardIds),
    tags: safeStrArray(row.tags),
    sourceHighlightId: safeStr(row.source_highlight_id ?? row.sourceHighlightId),
    reviewCount: safeNum(row.review_count ?? row.reviewCount),
    masteryLevel: safeNum(row.mastery_level ?? row.masteryLevel),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapKnowledgeCards(rows: unknown[]): KnowledgeCardRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapKnowledgeCard(r as Record<string, unknown>))
}

export function mapMethodology(row: Record<string, unknown>): MethodologyRow {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    name: safeStr(row.name, '未命名方法论'),
    nameEn: safeStr(row.name_en ?? row.nameEn),
    triggerScenario: safeStr(row.trigger_scenario ?? row.triggerScenario),
    description: safeStr(row.description),
    steps: safeStrArray(row.steps),
    outputFormat: safeStr(row.output_format ?? row.outputFormat),
    examples: safeStr(row.examples),
    tags: safeStrArray(row.tags),
    sourceHighlightIds: safeStrArray(row.source_highlight_ids ?? row.sourceHighlightIds),
    masteryLevel: safeNum(row.mastery_level ?? row.masteryLevel),
    practiceCount: safeNum(row.practice_count ?? row.practiceCount),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapMethodologies(rows: unknown[]): MethodologyRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapMethodology(r as Record<string, unknown>))
}

/**
 * 生词与文章的行类型。字段名**保持库里的下划线列名**，与上面那套驼峰不同 ——
 * 不是偷懒：这两张表的列名已经是界面契约（六个文件在读 meaning_zh / title_en /
 * is_mastered），改驼峰只为好看要动一整片读取点。
 *
 * 这一层真正的价值是**类型不再撒谎**：
 * `is_mastered` / `is_read` / `is_favorite` 在库里是 INTEGER 0/1，到这里是 boolean。
 * （踩过：`is_read` 类型写 boolean 而值是数字 0，React 把 0 当文本渲染出来，
 * 任务标题前凭空多出一个「0」。）
 */
export interface VocabularyRow {
  id: string
  word: string
  phonetic: string
  part_of_speech: string
  meaning_zh: string
  example_en: string
  example_zh: string
  cefr_level: string
  /** 遇到这个词的那篇文章（导入生词时写入；没有则空串，不是 undefined） */
  source_article_id: string
  source: string
  is_mastered: boolean
  review_count: number
  last_review_at: string
  next_review_at: string
  ef_factor: number
  interval_days: number
  repetition_count: number
  familiarity_level: number
  learning_stage: number
  /** FSRS-6.0 记忆状态（2026-09-15 起有列；掌握度由它推导） */
  stability: number
  difficulty: number
  lapses: number
  created_at: string
}

export interface ArticleRow {
  id: string
  title_en: string
  title_zh: string
  content_en: string
  content_zh: string
  summary_zh: string
  source: string
  source_url: string
  source_website: string
  category: string
  difficulty: string
  is_read: boolean
  is_favorite: boolean
  /** 读完这篇实际记了几分钟（来自微信读书/手动标记，不是估算） */
  read_time: number
  created_at: string
  published_at: string
}

export function mapVocabulary(row: Record<string, unknown>): VocabularyRow {
  return {
    id: safeStr(row.id),
    word: safeStr(row.word),
    phonetic: safeStr(row.phonetic),
    part_of_speech: safeStr(row.part_of_speech),
    meaning_zh: safeStr(row.meaning_zh),
    example_en: safeStr(row.example_en),
    example_zh: safeStr(row.example_zh),
    cefr_level: safeStr(row.cefr_level),
    source_article_id: safeStr(row.source_article_id),
    source: safeStr(row.source),
    is_mastered: safeBool(row.is_mastered),
    review_count: safeNum(row.review_count),
    last_review_at: safeStr(row.last_review_at),
    next_review_at: safeStr(row.next_review_at),
    ef_factor: safeNum(row.ef_factor, 2.5),
    interval_days: safeNum(row.interval_days),
    repetition_count: safeNum(row.repetition_count),
    familiarity_level: safeNum(row.familiarity_level),
    learning_stage: safeNum(row.learning_stage),
    stability: safeNum(row.stability),
    difficulty: safeNum(row.difficulty),
    lapses: safeNum(row.lapses),
    created_at: safeStr(row.created_at),
  }
}

export function mapVocabularies(rows: unknown[]): VocabularyRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapVocabulary(r as Record<string, unknown>))
}

export function mapArticle(row: Record<string, unknown>): ArticleRow {
  return {
    id: safeStr(row.id),
    title_en: safeStr(row.title_en, '无标题'),
    title_zh: safeStr(row.title_zh),
    content_en: safeStr(row.content_en),
    content_zh: safeStr(row.content_zh),
    summary_zh: safeStr(row.summary_zh),
    source: safeStr(row.source),
    source_url: safeStr(row.source_url),
    source_website: safeStr(row.source_website),
    category: safeStr(row.category),
    difficulty: safeStr(row.difficulty),
    is_read: safeBool(row.is_read),
    is_favorite: safeBool(row.is_favorite),
    read_time: safeNum(row.read_time),
    created_at: safeStr(row.created_at),
    published_at: safeStr(row.published_at),
  }
}

export function mapArticles(rows: unknown[]): ArticleRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapArticle(r as Record<string, unknown>))
}

/**
 * conversations 表的原始行（`conversationDb.getAll()` 等都是 `SELECT *`）。
 *
 * 这里曾同时存在三份"同一个会话行"的声明：`shared/types.ts` 的 `Conversation` 写驼峰
 * （运行时根本没有那些键，纯撒谎）、chatStore 的 `Session` 写驼峰 + 两种拼法都认、
 * 后台页的 `Session` 写下划线（唯一对的那份）。收成一份。
 */
export interface ConversationRow {
  id: string
  title: string
  book_id: string | null
  created_at: string
  updated_at: string
  message_count: number
  history_summary: string | null
  /** 后台的会话列表多带一个 JOIN 出来的书名；常规通道没有这一列 */
  book_title?: string
}

export interface ChatMessageRow {
  id: string
  conversation_id: string
  /** schema 上有 CHECK(role IN ('user','assistant','system'))，所以收窄是安全的 */
  role: 'user' | 'assistant' | 'system'
  content: string
  intent: string | null
  /** JSON 文本列：数组/对象在库里就是字符串 */
  tools_used: string | null
  bloom_level: number | null
  mastery_assessment: string | null
  sources: string | null
  liked: number
  bookmarked: number
  created_at: string
}

/** 会话行给界面用的形状：驼峰 + `bookId` 空串表示「未关联书」 */
export interface ConversationView {
  id: string
  title: string
  bookId: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** 后台的会话列表多带一个 JOIN 出来的书名；常规通道就是空串 */
  bookTitle: string
}

/** 一条 AI / 用户消息（JSON 文本列已解析成结构） */
export interface MasteryAssessment {
  concept: string
  level: number
  confidence: number
}

export interface ChatMessageView {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  intent: string
  toolsUsed: string[]
  bloomLevel: number
  masteryAssessment: MasteryAssessment | null
  sources: RagSourceRef[]
  liked: boolean
  bookmarked: boolean
  createdAt: string
}

export function mapConversation(row: ConversationRow): ConversationView {
  return {
    id: safeStr(row.id),
    title: safeStr(row.title, '新对话'),
    // 空串 = 没有关联书籍。原来 chatStore 用 undefined 表示同一件事，
    // 于是每个消费点都要写 `bookId != null && bookId !== ''` —— 一种意思两种判法。
    bookId: safeStr(row.book_id),
    createdAt: safeStr(row.created_at),
    updatedAt: safeStr(row.updated_at),
    messageCount: safeNum(row.message_count),
    bookTitle: safeStr(row.book_title),
  }
}

export function mapConversations(rows: unknown[]): ConversationView[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapConversation(r as ConversationRow))
}

/** 容错解析 DB 中的 JSON 对象列：损坏或不是对象时回退 null（不猜、不炸整条会话） */
export function safeJsonObject<T>(val: unknown): T | null {
  if (typeof val !== 'string' || !val) return null
  try {
    const parsed: unknown = JSON.parse(val)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as T
  } catch {
    return null
  }
}

export function mapChatMessage(row: ChatMessageRow): ChatMessageView {
  return {
    id: safeStr(row.id),
    conversationId: safeStr(row.conversation_id),
    role: row.role === 'user' || row.role === 'system' ? row.role : 'assistant',
    content: safeStr(row.content),
    intent: safeStr(row.intent),
    toolsUsed: safeStrArray(row.tools_used),
    bloomLevel: safeNum(row.bloom_level),
    masteryAssessment: safeJsonObject<MasteryAssessment>(row.mastery_assessment),
    sources: safeJsonArray(row.sources) as RagSourceRef[],
    liked: safeBool(row.liked),
    bookmarked: safeBool(row.bookmarked),
    createdAt: safeStr(row.created_at),
  }
}

export function mapChatMessages(rows: unknown[]): ChatMessageView[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapChatMessage(r as ChatMessageRow))
}
