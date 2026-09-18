/**
 * 章节摘要的纯计算部分（RAPTOR 简化版的 L1 层）—— main / renderer / 测试共用。
 *
 * 放这里的只有「不需要数据库、不需要 AI」的决策逻辑：怎么分章、哪些章节需要重做、
 * 注入提示长什么样。放在 shared 是为了能被单测逐条钉住 —— 摘要生成一次要烧掉
 * 几十次 AI 调用，判定错了就是白花花的钱，不能只靠人眼 Review。
 */

/** 章节名为空时统一归到这里，而不是丢掉这条划线 */
export const UNGROUPED_CHAPTER = '未分章'

/** 单章最多送进提示词的条数：一章 200 条划线会把提示词撑爆 */
export const MAX_CONTENTS_PER_CHAPTER = 60

/** 单条划线的字数上限（超长引用截断，保留开头） */
const MAX_CONTENT_CHARS = 300

export interface ChapterHighlightInput {
  chapterTitle?: string | null
  content?: string | null
}

export interface ChapterGroup {
  chapterTitle: string
  /** 实际送入提示词的条目（已截断条数与字数） */
  contents: string[]
  /** 该章划线总条数 —— 新鲜度判定用它，不是用 contents.length */
  total: number
}

export interface ExistingChapterSummary {
  chapterTitle: string
  sourceCount: number
}

export interface ChapterSummaryPlan {
  toGenerate: ChapterGroup[]
  /** 条数没变、直接复用的章节 */
  toSkip: string[]
}

function compareChapterTitle(a: string, b: string): number {
  if (a === UNGROUPED_CHAPTER) return b === UNGROUPED_CHAPTER ? 0 : 1
  if (b === UNGROUPED_CHAPTER) return -1
  // numeric: true —— 「第2章」要排在「第10章」前面，字典序会反过来
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

/** 按章节分组：空正文跳过（补不出摘要），组内保持传入顺序 */
export function groupHighlightsByChapter(rows: ChapterHighlightInput[]): ChapterGroup[] {
  const buckets = new Map<string, string[]>()
  for (const row of rows) {
    const content = (row.content ?? '').trim()
    if (!content) continue
    const chapter = (row.chapterTitle ?? '').trim() || UNGROUPED_CHAPTER
    const bucket = buckets.get(chapter)
    if (bucket) bucket.push(content)
    else buckets.set(chapter, [content])
  }

  return [...buckets.entries()]
    .sort((a, b) => compareChapterTitle(a[0], b[0]))
    .map(([chapterTitle, contents]) => ({
      chapterTitle,
      contents: contents.slice(0, MAX_CONTENTS_PER_CHAPTER).map(truncateContent),
      total: contents.length,
    }))
}

function truncateContent(content: string): string {
  return content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}…` : content
}

/**
 * 计算这次要重做哪些章节。
 *
 * 判定依据是**该章划线条数**：条数变了就重做，没变就复用已有摘要。
 * 这是条数签名而不是内容签名 —— 删一条同时加一条（总数不变）不会触发重做。
 * 代价换的是「同步一次书架不会把全书几十章重新烧一遍 AI」，是明确的取舍。
 */
export function planChapterSummaries(
  groups: ChapterGroup[],
  existing: ExistingChapterSummary[],
): ChapterSummaryPlan {
  const existingByChapter = new Map(existing.map((e) => [e.chapterTitle, e.sourceCount]))
  const toGenerate: ChapterGroup[] = []
  const toSkip: string[] = []

  for (const group of groups) {
    const stored = existingByChapter.get(group.chapterTitle)
    if (stored === group.total) toSkip.push(group.chapterTitle)
    else toGenerate.push(group)
  }

  return { toGenerate, toSkip }
}

/** 送入提示词的章节正文（每章一份，逐条列出让模型能对回原文） */
export function formatChapterContents(group: ChapterGroup): string {
  const lines = group.contents.map((content, i) => `${i + 1}. ${content}`)
  if (group.total > group.contents.length) {
    lines.push(`（该章共 ${group.total} 条划线，以上为前 ${group.contents.length} 条）`)
  }
  return lines.join('\n')
}

export interface SummaryForInjection {
  chapterTitle: string
  summary: string
}

export interface SummaryContextInput {
  /** L2 全书摘要；「这本书讲什么」这类问题要的是它，不是逐章片段 */
  bookSummary?: string | null
  /** L1 章节摘要（已按相关性挑过） */
  chapters: SummaryForInjection[]
}

/**
 * 注入到提示词的「摘要」段（L2 + L1）。
 *
 * 必须写清这是 AI 生成的二手概括而不是原文 —— 模型把它当原文引用会误导用户。
 */
export function formatSummaryContext({ bookSummary, chapters }: SummaryContextInput): string {
  const lines: string[] = []
  const overview = (bookSummary ?? '').trim()
  if (overview) lines.push(`【全书】${overview}`)
  for (const chapter of chapters) {
    const body = chapter.summary.trim()
    if (body) lines.push(`【${chapter.chapterTitle}】${body}`)
  }
  if (lines.length === 0) return ''
  return `\n\n## 书籍摘要（AI 依据你的划线概括，非原书正文）\n${lines.join('\n\n')}\n`
}

/** 由 L1 章节摘要拼出 L2（全书摘要）的输入 */
export function formatChapterSummariesForBook(items: SummaryForInjection[]): string {
  return items.map((item) => `[${item.chapterTitle}] ${item.summary.trim()}`).join('\n\n')
}
