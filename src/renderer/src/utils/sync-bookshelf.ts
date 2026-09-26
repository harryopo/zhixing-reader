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

import { planBookSync, type WereadBookLike } from '../../../shared/weread-book-sync'

/** 微信读书 API 返回的书籍字段 —— 就是同步计划要读的那几个字段（唯一声明在共享层） */
type WereadBook = WereadBookLike

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
  /**
   * 写库失败的本数。此前没有这个计数：30 本全部写失败，
   * 界面照样弹「书架已是最新，共 30 本书」—— 失败必须能被调用方看见。
   */
  failedCount: number
  /** 失败的书名（最多留 5 个用于提示，完整列表在日志里） */
  failedTitles: string[]
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
    return { total: 0, newCount: 0, updatedCount: 0, failedCount: 0, failedTitles: [] }
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
  const failedTitles: string[] = []
  for (const wb of booksToSync) {
    try {
      // 判重按 bookId、更新时不许带上进度列 —— 这两条与主进程后台自动同步
      // 共用一份计划（src/shared/weread-book-sync.ts），不再各写一遍各漂一次的。
      const existing = await window.electronAPI.book.getById(wb.bookId)
      const plan = planBookSync(wb, existing)
      if (plan.action === 'create') {
        await window.electronAPI.book.create(plan.fields)
        newCount++
      } else {
        await window.electronAPI.book.update(plan.id, plan.fields)
        updatedCount++
      }
    } catch (error) {
      failedTitles.push(wb.title)
      if (onItemError) onItemError(wb.title, error)
    }
  }

  return {
    total: wereadBooks.length,
    newCount,
    updatedCount,
    failedCount: failedTitles.length,
    failedTitles: failedTitles.slice(0, 5),
  }
}

/**
 * 同步结果 → 一句提示。三处调用方（顶栏 / 书架 / 设置-微信读书）共用一张嘴，
 * 免得某一份自己拼文案时把 failedCount 漏掉 —— 那是"30 本全失败还说已是最新"的来源。
 */
export function describeSyncResult(result: SyncResult): {
  tone: 'success' | 'warning'
  text: string
} {
  const listed = result.newCount > 0 ? `新导入 ${result.newCount} 本，更新 ${result.updatedCount} 本` : '无新增'
  if (result.failedCount > 0) {
    const names = result.failedTitles.length > 0 ? `：${result.failedTitles.join('、')}` : ''
    return {
      tone: 'warning',
      text: `${result.failedCount} 本没写进去（共 ${result.total} 本，${listed}）${names}`,
    }
  }
  return {
    tone: 'success',
    text: result.newCount > 0
      ? `同步完成，共 ${result.total} 本，新导入 ${result.newCount} 本，更新 ${result.updatedCount} 本`
      : `同步完成，共 ${result.total} 本，无新增`,
  }
}
