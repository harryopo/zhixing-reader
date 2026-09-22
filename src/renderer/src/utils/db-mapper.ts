export function safeNum(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

export function safeStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback
  return String(val)
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
