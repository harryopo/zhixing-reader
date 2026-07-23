/**
 * sync-bookshelf — Topbar 与 Bookshelf 共用的微信读书书架同步逻辑
 *
 * 提取自 Topbar.tsx handleSync 与 Bookshelf.tsx handleSync,统一维护避免 DRY 违规。
 *
 * 职责：拉书架 → book.search 判断 → book.create / book.update,返回统计结果。
 * 不负责：toast 提示、localStorage 写入、UI 状态刷新（都由调用方处理）。
 *
 * 调用方约定：
 *   - Topbar：调用后自己写 LAST_SYNC_KEY + refreshNotifData
 *   - Bookshelf：调用后自己调 loadData 刷新本地状态
 */

import { Book } from '../../../shared/types'

/** 微信读书 API 返回的书籍字段 */
interface WereadBook {
  bookId: string
  title: string
  author?: string
  cover?: string
  isbn?: string
  publisher?: string
  intro?: string
  publishTime?: string
  category?: string
  progress?: number
  totalChapter?: number
  lastReadTime?: number
  readUpdateTime?: number
  finishReading?: number
}

export interface SyncBookshelfOptions {
  /** 是否按最近阅读时间排序后再写库（Bookshelf 用 true,Topbar 用 false） */
  sortByRecent?: boolean
  /** 单本同步失败的回调（Bookshelf 用 console.error,Topbar 静默） */
  onItemError?: (bookTitle: string, error: unknown) => void
}

export interface SyncResult {
  /** 微信读书返回的书籍总数 */
  total: number
  /** 新导入数 */
  newCount: number
  /** 更新数 */
  updatedCount: number
}

/**
 * 从微信读书拉书架并同步到本地数据库。
 * @returns 同步统计结果（total === 0 表示空书架）
 * @throws 当微信读书 API 失败时抛出,由调用方 catch 处理
 */
export async function syncBookshelfToDb(
  options: SyncBookshelfOptions = {},
): Promise<SyncResult> {
  const { sortByRecent = false, onItemError } = options

  const wereadBooks = (await window.electronAPI.weread.getBookshelf()) as WereadBook[]

  if (!wereadBooks || wereadBooks.length === 0) {
    return { total: 0, newCount: 0, updatedCount: 0 }
  }

  // Bookshelf 行为：按最近阅读时间倒序后写库；Topbar 行为：保持原顺序
  const booksToSync = sortByRecent
    ? [...wereadBooks].sort(
        (a, b) =>
          (b.readUpdateTime || b.lastReadTime || 0) -
          (a.readUpdateTime || a.lastReadTime || 0),
      )
    : wereadBooks

  let newCount = 0
  let updatedCount = 0
  for (const wb of booksToSync) {
    try {
      const existingBooks = (await window.electronAPI.book.search(wb.title)) as unknown as Book[]
      const exists = existingBooks.some((b) => b.title === wb.title)
      const readTime = wb.readUpdateTime || wb.lastReadTime || 0
      const lastReadTimeStr = readTime > 0 ? new Date(readTime * 1000).toISOString() : null

      if (!exists) {
        await window.electronAPI.book.create({
          id: wb.bookId,
          title: wb.title,
          author: wb.author,
          cover: wb.cover,
          isbn: wb.isbn,
          publisher: wb.publisher,
          description: wb.intro || '',
          category: wb.category || '',
          publish_date: wb.publishTime || '',
          reading_progress: wb.progress || 0,
          total_chapter: wb.totalChapter || 0,
          last_read_time: lastReadTimeStr,
          is_finished: wb.finishReading || 0,
          source: 'weread',
        })
        newCount++
      } else {
        const existing = existingBooks.find((b) => b.title === wb.title)
        if (existing && existing.id) {
          await window.electronAPI.book.update(existing.id as string, {
            author: wb.author || null,
            cover: wb.cover || null,
            isbn: wb.isbn || null,
            publisher: wb.publisher || null,
            description: wb.intro || null,
            category: wb.category || null,
            publish_date: wb.publishTime || null,
            reading_progress: wb.progress || 0,
            last_read_time: lastReadTimeStr,
            is_finished: wb.finishReading || 0,
          })
          updatedCount++
        }
      }
    } catch (error) {
      if (onItemError) onItemError(wb.title, error)
    }
  }

  return { total: wereadBooks.length, newCount, updatedCount }
}
