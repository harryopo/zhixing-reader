/**
 * weread-book-sync — 「一本微信读书的书该怎么写进本地 books 表」的唯一一份判定
 *
 * 为什么要有这个文件：写 books 表的自动同步通路有两条 ——
 *   - 渲染层 `utils/sync-bookshelf.ts`（顶栏/书架/设置里手动点「同步」）
 *   - 主进程 `electron/weread-sync-manager.ts`（按频率跑的后台自动同步）
 * 两条各写一份字段映射与判重规则，就会各漂各的：手动那条 2026-09-20 修过的两个坑
 * （按书名判重、更新时写 progress），后台那条一直照着旧写法抄着，谁也没对过。
 * 这里只留一份计划，两条通路都消费它。
 */

/** `/shelf/sync` 交回的一本书（`WereadBook` 的本文件所需子集，两边形状一致） */
export interface WereadBookLike {
  bookId: string
  title: string
  author?: string
  cover?: string
  isbn?: string
  publisher?: string
  publishTime?: string
  intro?: string
  category?: string
  finishReading?: number
  progress?: number
  totalChapter?: number
  lastReadTime?: number
  readUpdateTime?: number
}

/** 库里已有的那一行（`book.getById` / `booksDb.getById` 交回的原始行，只用到 id） */
export interface ExistingBookRow {
  id?: unknown
  [key: string]: unknown
}

export type BookSyncPlan =
  | { action: 'create'; id: string; fields: Record<string, unknown> }
  | { action: 'update'; id: string; fields: Record<string, unknown> }

/**
 * 微信读书给的是秒级 epoch，本地列存 ISO 串；两个字段哪个有用哪个，都没有就是 null。
 * 注意不是 0 —— 0 会被 `new Date(0)` 变成 1970，界面上就成了"上次读是 1970 年"。
 */
export function lastReadTimeIso(wb: WereadBookLike): string | null {
  const readTime = wb.readUpdateTime || wb.lastReadTime || 0
  return readTime > 0 ? new Date(readTime * 1000).toISOString() : null
}

/** 缺字段一律落成 null：这些值直接绑进 SQL，undefined 与 null 不该两种都出现 */
function orNull(value: string | undefined): string | null {
  return value || null
}

/** 数字列的缺省就是 0（进度、章数、是否读完都没有"未知"这一档） */
function orZero(value: number | undefined): number {
  return value || 0
}

/**
 * 判重按 bookId（本地 id 就是微信读书的 bookId），不按书名：
 * 同名两本（不同版本 / 不同作者）按书名判重会让第二本永远进不来，
 * 还会把第一本的 author 覆盖掉。
 */
export function planBookSync(
  wb: WereadBookLike,
  existing: ExistingBookRow | undefined | null,
): BookSyncPlan {
  const lastReadTime = lastReadTimeIso(wb)

  if (!existing || typeof existing.id !== 'string' || existing.id.length === 0) {
    return {
      action: 'create',
      id: wb.bookId,
      fields: {
        id: wb.bookId,
        title: wb.title,
        author: orNull(wb.author),
        cover: orNull(wb.cover),
        isbn: orNull(wb.isbn),
        publisher: orNull(wb.publisher),
        publish_date: orNull(wb.publishTime),
        description: orNull(wb.intro),
        category: orNull(wb.category),
        // 新建时库里还没有进度，写 0 是对的；更新时不许写（见下面 update 分支）。
        reading_progress: orZero(wb.progress),
        total_chapter: orZero(wb.totalChapter),
        last_read_time: lastReadTime,
        is_finished: orZero(wb.finishReading),
      },
    }
  }

  return {
    action: 'update',
    id: existing.id,
    fields: {
      author: orNull(wb.author),
      cover: orNull(wb.cover),
      isbn: orNull(wb.isbn),
      publisher: orNull(wb.publisher),
      publish_date: orNull(wb.publishTime),
      description: orNull(wb.intro),
      category: orNull(wb.category),
      // 这里**故意不写 reading_progress**：/shelf/sync 的 books[] 不返回 progress，
      // weread-api 统一映射成 0；一写就把 getBookProgress() 缓存进库的真实进度抹成 0
      // —— 书架进度条归零、档案页「读完 N 本」（判 reading_progress >= 1）跟着掉。
      last_read_time: lastReadTime,
      is_finished: orZero(wb.finishReading),
    },
  }
}
