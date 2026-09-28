/**
 * 从微信读书导入划线 / 笔记 —— 单一实现
 *
 * ## 为什么要有这个文件
 * 2026-09-16 排查发现：`Bookshelf.tsx` 与 `BookDetail.tsx` 各有一份
 * **逻辑一字不差**（只有变量名不同）的导入循环，而且两份**错得一模一样** ——
 * 都只读 `bookmarks` / `notes`，把 `fetchAllContent` 一起取回来的
 * `chapters`（章节对照表）丢掉，导致 934 条划线的章节名全空。
 *
 * 同一定义存在多份，是本项目反复栽跟头的地方（schema、评分档位、这里的导入）。
 * 所以导入逻辑只留这一份，两个页面都调它。
 *
 * ## 与旧行为的区别
 * - 补全章节名：优先用条目自带标题，没有就用 `chapterUid` 查章节表
 * - **改为 upsert**：以前遇到已存在的划线直接跳过；现在会在"已有但章节名为空"时
 *   补写章节名。这样重新导入一次就能修复历史数据，不必删库重来。
 * - 「一行该带哪些字段」不再由本文件决定，改吃 `src/shared/weread-content` 的
 *   `planHighlightRows`。09-16 那次只把**章节名**收成一份，字段清单仍在三处各写一遍，
 *   于是三条通路各自犯过同一批错（漏 id、绕开章节对照表、把 `created_at` 传给一个不认这列的 INSERT）。
 */

import { planHighlightRows } from '../../../shared/weread-content'

export interface ImportResult {
  /** 本轮扫描到的划线 + 笔记总数 */
  total: number
  /** 新建的条数 */
  created: number
  /** 已存在、但本次补上了章节名的条数 */
  chapterFilled: number
  /** 已存在且无需改动的条数 */
  skipped: number
  /** 导入过程中单条失败次数（不中断整体导入） */
  failed: number
}

interface RawHighlightRow {
  id?: string
  content?: string
  chapter_title?: string | null
  chapterTitle?: string | null
}

function readChapterTitle(row: RawHighlightRow): string {
  const v = row.chapter_title ?? row.chapterTitle ?? ''
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 导入一本书的微信读书划线 / 笔记。
 *
 * 失败单条只记数不抛出：整体导入不该因为一条脏数据全废。
 */
export async function importWereadContentForBook(bookId: string): Promise<ImportResult> {
  const api = window.electronAPI
  if (!api?.weread?.fetchAllContent || !api?.highlight?.create) {
    throw new Error('API 未正确初始化，请重启应用')
  }

  const content = await api.weread.fetchAllContent(bookId)
  const rows = planHighlightRows(content as Parameters<typeof planHighlightRows>[0])

  // 已存在的划线：按 content 建索引（create 的去重口径就是 (book_id, content)）
  const existingRows = (await api.highlight.getByBook(bookId)) as unknown as RawHighlightRow[]
  const existingByContent = new Map<string, RawHighlightRow>()
  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    if (row?.content) existingByContent.set(row.content, row)
  }

  const result: ImportResult = { total: 0, created: 0, chapterFilled: 0, skipped: 0, failed: 0 }

  for (const row of rows) {
    result.total++
    try {
      const existing = existingByContent.get(row.content)
      if (existing) {
        // 已存在：只在"原本没有章节名、现在能解析出来"时补写，避免无谓写库
        const had = readChapterTitle(existing)
        if (!had && row.chapter_title && existing.id) {
          await api.highlight.update(existing.id, { chapter_title: row.chapter_title })
          result.chapterFilled++
        } else {
          result.skipped++
        }
        continue
      }

      // 字段名与库里那一列逐字相同（planHighlightRows 保证），主进程只认两种写法
      const isNew = await api.highlight.create({ bookId, ...row })
      if (isNew) result.created++
      else result.skipped++
    } catch (e) {
      result.failed++
      console.error('导入条目失败:', e)
    }
  }

  return result
}

/** 把导入结果压成一句人话（两个页面共用同一套说法） */
export function describeImportResult(r: ImportResult): { kind: 'success' | 'info'; text: string } {
  if (r.total === 0) return { kind: 'info', text: '没有找到笔记' }

  const parts: string[] = []
  if (r.created > 0) parts.push(`新增 ${r.created} 条`)
  if (r.chapterFilled > 0) parts.push(`补全 ${r.chapterFilled} 条章节名`)
  if (r.failed > 0) parts.push(`${r.failed} 条失败`)

  if (parts.length === 0) return { kind: 'info', text: '笔记已是最新，无需重复导入' }
  return { kind: 'success', text: `导入完成！${parts.join(' · ')}` }
}
