export function safeNum(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

export function safeStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback
  return String(val)
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

export function mapBook(row: Record<string, unknown>): Record<string, unknown> {
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
    progress: safeNum(row.reading_progress ?? row.progress),
    reading_progress: safeNum(row.reading_progress ?? row.progress),
    totalChapter: safeNum(row.total_chapter ?? row.totalChapter),
    lastReadAt: safeDate(row.last_read_time ?? row.lastReadAt),
    publishDate: safeDate(row.publish_date ?? row.publishDate ?? row.publishTime),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapHighlight(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId),
    chapterTitle: safeStr(row.chapter_title ?? row.chapterTitle, '未知章节'),
    chapterId: safeStr(row.chapter_id ?? row.chapterId ?? row.chapterUid ?? ''),
    content: safeStr(row.content),
    note: safeStr(row.note),
    color: safeStr(row.color, '#facc15'),
    style: safeNum(row.style),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapCard(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    highlightId: safeStr(row.highlight_id ?? row.highlightId),
    nextReviewAt: safeDate(row.due ?? row.next_review_at ?? row.nextReviewAt),
    lastReviewAt: safeDate(row.last_review ?? row.last_review_at ?? row.lastReviewAt),
    reviewCount: safeNum(row.reps ?? row.review_count ?? row.reviewCount),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapBooks(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapBook(r as Record<string, unknown>))
}

export function mapHighlights(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapHighlight(r as Record<string, unknown>))
}

export function mapCards(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapCard(r as Record<string, unknown>))
}

export function mapKnowledgeCard(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    type: row.type as 'concept' | 'methodology' | 'quote',
    title: safeStr(row.title, '无标题'),
    content: safeStr(row.content),
    interpretation: safeStr(row.interpretation),
    application: safeStr(row.application),
    relatedCardIds: row.related_card_ids ?? row.relatedCardIds,
    tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [],
    sourceHighlightId: safeStr(row.source_highlight_id ?? row.sourceHighlightId),
    reviewCount: safeNum(row.review_count ?? row.reviewCount),
    masteryLevel: safeNum(row.mastery_level ?? row.masteryLevel),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapKnowledgeCards(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapKnowledgeCard(r as Record<string, unknown>))
}

export function mapMethodology(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: safeStr(row.id),
    bookId: safeStr(row.book_id ?? row.bookId ?? ''),
    name: safeStr(row.name, '未命名方法论'),
    nameEn: safeStr(row.name_en ?? row.nameEn),
    triggerScenario: safeStr(row.trigger_scenario ?? row.triggerScenario),
    description: safeStr(row.description),
    steps: row.steps ? (typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps) : [],
    outputFormat: safeStr(row.output_format ?? row.outputFormat),
    examples: safeStr(row.examples),
    tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [],
    sourceHighlightIds: row.source_highlight_ids ?? row.sourceHighlightIds,
    masteryLevel: safeNum(row.mastery_level ?? row.masteryLevel),
    practiceCount: safeNum(row.practice_count ?? row.practiceCount),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    updatedAt: safeDate(row.updated_at ?? row.updatedAt),
  }
}

export function mapMethodologies(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r => mapMethodology(r as Record<string, unknown>))
}
