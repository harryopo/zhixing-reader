/**
 * notes-export — 导出读书笔记的那份 Markdown
 *
 * ## 为什么要收成一份
 *
 * 导出笔记曾经有**两条通路各写一份拼 Markdown 的逻辑**：笔记页走主进程
 * `highlights:export`，设置页在渲染层自己拼。两边已经漂了：标题不同、
 * 一边有 `---` 分隔一边没有、一边带章节名与时间另一边不带 ——
 * "导出笔记"在应用里是两个东西，而界面上长得一样。
 *
 * 本文件是**唯一**的拼装处，两个入口都调它，所以同一份数据导出两次逐字节相同。
 *
 * ## 格式为谁而排（这是排版的唯一理由，别当成审美偏好）
 *
 * 写文章时要翻的是**自己写下的想法**，不是作者的句子。实测库里 1031 条划线里
 * 只有 40 条带自己的想法，其余 991 条是作者原句 —— 原来按时间平铺，
 * 40 条想法被埋在 991 条里找不到。所以每本书内分两段：
 *
 *   1. **我写过的**（有想法）：你的原话 + 它对应的那句原文
 *   2. **我划过的**（只有划线）：作者的句子，引用时用
 *
 * 正文与想法都空的划线**跳过**：它在文件里就是一个空的引用块（实测 8 条），
 * 导出它等于告诉读者"这里有一条笔记"，而实际上什么都没有。
 * 有想法没正文的**保留** —— 那一刻想法本身就是内容。
 */
import { parseDbTime } from './db-time'

/** 库里那一行的形状：只声明这份格式要用的字段，其余列靠真实行透传 */
export interface HighlightRow {
  id?: string
  book_id?: string
  bookId?: string
  content?: unknown
  note?: unknown
  chapter_title?: string
  chapterTitle?: string
  created_at?: string
}

export interface BookRow {
  id?: string
  title?: unknown
  author?: unknown
}

const trim = (v: unknown): string => String(v ?? '').trim()

/** 库里 `book_id` 与渲染层 `bookId` 两个拼法都认 —— 两条通路各喂一种过来 */
function bookIdOf(h: HighlightRow): string {
  return trim(h.book_id) || trim(h.bookId) || 'unknown'
}

function chapterOf(h: HighlightRow): string {
  return trim(h.chapter_title) || trim(h.chapterTitle)
}

/**
 * 解析不出就回 0，调用方据此说"未知时间" ——
 * 不把浏览器那句 `Invalid Date` 印进用户拿走的文件里。
 * 与渲染层 `db-mapper` 同一把尺（库里那串是 UTC 墙上时钟，直接 new Date 会差 8 小时）。
 */
function timeOf(h: HighlightRow): number {
  return parseDbTime(h.created_at)?.getTime() ?? 0
}

/** Markdown 里裸换行会被渲染成同一段，多行文本要显式断行 */
const escapeMd = (s: unknown): string => trim(s).replace(/\n/g, '  \n')

function hasNote(h: HighlightRow): boolean {
  return trim(h.note).length > 0
}

function hasContent(h: HighlightRow): boolean {
  return trim(h.content).length > 0
}

export interface NotesExportBook {
  bookId: string
  title: string
  author: string
  /** 我写过的（正文 + 想法都在，或者是空正文只有想法） */
  withNote: HighlightRow[]
  /** 我只划了，没写想法 —— 作者的原句 */
  markedOnly: HighlightRow[]
}

export interface NotesExportResult {
  markdown: string
  books: number
  /** 真正写进文件里的条数（跳过了空的那几条） */
  total: number
  skipped: number
  /** 界面上那句提示用这几个数，不要在界面侧重新数一遍 */
  summary: string
}

/**
 * 书内排序：**想法在前**，且各自按时间倒序。
 * 想法在前是硬要求（理由见文件头）；时间倒序是"最近写的想法最上面"，
 * 与「按天归集」那条口径无关，纯粹是好找。
 */
function sortForWriting(list: HighlightRow[]): HighlightRow[] {
  return [...list].sort((a, b) => timeOf(b) - timeOf(a))
}

/** 文件抬头：单本用书名、多本用通用名；并说清其中多少条是你自己写的 */
function header(
  sections: readonly NotesExportBook[],
  now: Date,
  total: number,
  noteCount: number,
  skipped: number,
): string {
  const title =
    sections.length === 1
      ? `# 读书笔记 · ${sections[0]?.title ?? ''}`
      : '# 知行读书 · 读书笔记导出'
  const parts = [
    `${title}`,
    '',
    `导出于 ${now.toLocaleString('zh-CN')} · ${sections.length} 本书 · 共 ${total} 条，其中 ${noteCount} 条是你自己写下的`,
  ]
  // 跳过的数目要写出来，不静默丢
  if (skipped > 0) parts.push(`另有 ${skipped} 条既没有原文也没有你的想法，没有写进来。`)
  return parts.join('\n')
}

/** 目录：每本书各多少条。只在多本时摆 —— 单本的目录是个只有一条的目录 */
function toc(sections: readonly NotesExportBook[]): string {
  const rows = sections.map((s) => {
    const counts = [
      s.withNote.length > 0 ? `你的想法 ${s.withNote.length}` : '',
      `划线 ${s.markedOnly.length}`,
    ]
      .filter(Boolean)
      .join(' · ')
    return `- 《${s.title}》 —— ${counts}`
  })
  return ['## 目录', '', ...rows].join('\n')
}

/** 一条的小标题：章节 + 时间。章节是引用时要的信息（库里 1019 条本来就有，不导出来等于白存） */
function whereAndWhen(h: HighlightRow): string {
  const chapter = chapterOf(h)
  const stamp = timeOf(h)
  const time = stamp > 0 ? new Date(stamp).toLocaleString('zh-CN') : '时间未知'
  return chapter ? `**${chapter}** · ${time}` : time
}

/** 摆一段（同一种的两条循环走这一个，格式才没机会各写一遍） */
function renderSection(
  lines: string[],
  title: string,
  rows: readonly HighlightRow[],
  withNote: boolean,
): void {
  if (rows.length === 0) return
  lines.push(`### ${title}`, '')
  for (const h of rows) {
    lines.push(whereAndWhen(h), '')
    // 有想法但正文空的那条：只摆想法，不留一个空引用块
    if (hasContent(h)) lines.push(`> ${escapeMd(h.content)}`, '')
    if (withNote) lines.push(`**想法：**${escapeMd(h.note)}`, '')
  }
}

export function buildNotesMarkdown(input: {
  highlights: readonly HighlightRow[]
  books: readonly BookRow[]
  /** 导出这一刻；只在抬头写一次，测试里给固定值 */
  now: Date
  /** 只导这一本书时传 bookId；不传 = 全库 */
  onlyBookId?: string
}): NotesExportResult {
  const titleOf = new Map(
    input.books.map((b) => [trim(b.id) || 'unknown', { title: trim(b.title) || '未知书籍', author: trim(b.author) }]),
  )

  const byBook = new Map<string, { withNote: HighlightRow[]; markedOnly: HighlightRow[] }>()
  let skipped = 0
  for (const h of input.highlights) {
    const bid = bookIdOf(h)
    if (input.onlyBookId && bid !== input.onlyBookId) continue
    // 正文与想法都是空的：文件里只会多出一个空引用块，跳过并计数
    if (!hasContent(h) && !hasNote(h)) {
      skipped += 1
      continue
    }
    const bucket = byBook.get(bid) ?? { withNote: [], markedOnly: [] }
    if (hasNote(h)) bucket.withNote.push(h)
    else bucket.markedOnly.push(h)
    byBook.set(bid, bucket)
  }

  const sections: NotesExportBook[] = [...byBook.entries()].map(([bookId, bucket]) => {
    const meta = titleOf.get(bookId)
    return {
      bookId,
      title: meta?.title ?? '未知书籍',
      author: meta?.author ?? '',
      withNote: sortForWriting(bucket.withNote),
      markedOnly: sortForWriting(bucket.markedOnly),
    }
  })
  // 有想法的书排前面 —— 写文章时先翻这些
  sections.sort((a, b) => b.withNote.length - a.withNote.length || a.title.localeCompare(b.title))

  const total = sections.reduce((sum, s) => sum + s.withNote.length + s.markedOnly.length, 0)
  const noteCount = sections.reduce((sum, s) => sum + s.withNote.length, 0)

  const lines: string[] = []
  lines.push(header(sections, input.now, total, noteCount, skipped))
  if (sections.length > 1) lines.push(toc(sections))

  for (const s of sections) {
    lines.push(`## 《${s.title}》`, '')
    if (s.author) lines.push(`*${s.author}*`, '')
    renderSection(lines, '你写下的', s.withNote, true)
    renderSection(lines, '你划过的', s.markedOnly, false)
    lines.push('---', '')
  }

  const summary = skipped > 0
    ? `${sections.length} 本书 · ${total} 条（含你的想法 ${noteCount} 条）· 跳过 ${skipped} 条空白`
    : `${sections.length} 本书 · ${total} 条（含你的想法 ${noteCount} 条）`

  return { markdown: lines.join('\n'), books: sections.length, total, skipped, summary }
}

/** 文件名：按书导出时带上书名，全库导出用通用名 */
export function notesFileName(title: string | undefined, now: Date): string {
  const day = now.toISOString().slice(0, 10)
  if (!title) return `zhixing-notes-${day}.md`
  const safe = title.replace(/[\\/:*?"<>|]/g, '').trim()
  return safe ? `读书笔记-${safe}-${day}.md` : `zhixing-notes-${day}.md`
}