/**
 * 微信读书内容 → 章节名解析
 *
 * ## 为什么需要它（2026-09-16 实测发现的问题）
 * 用户数据库里 934 条划线，`chapter_title` **有值 0 条**。
 *
 * 根因：微信读书的 `/book/bookmarklist` 只保证返回 `chapterUid`，
 * `chapterTitle` 常常是空的；章节名要靠另一个接口 `/book/chapterinfo` 拿。
 * `fetchAllContent` **确实**一起取了 `chapters` 并返回，
 * 但三个导入入口（Bookshelf / BookDetail / 主进程蒸馏）全都只读 bookmarks 和 notes，
 * **把 chapters 丢掉不用** —— 一次 API 调用白花了，章节名永远是空字符串。
 *
 * ## 为什么放在 shared
 * 同一段逻辑原本在三个地方各写一遍（而且三处错得一模一样）。
 * 本项目已经因为"同一定义存在多份"栽过两次（schema、评分档位），
 * 所以这里只留一份，主进程与渲染层共用。
 *
 * 纯函数、零依赖。
 */

/** 章节表条目（来自 /book/chapterinfo） */
export interface WereadChapterRef {
  chapterUid: number
  title: string
  level?: number
}

/** 任何带 chapterUid / chapterTitle 的微信读书条目（划线或笔记） */
export interface ChapterCarrier {
  chapterUid?: number | null
  chapterTitle?: string | null
}

/** 建立 chapterUid → 章节标题 的对照表 */
export function buildChapterTitleMap(chapters: readonly WereadChapterRef[] | undefined | null): Map<number, string> {
  const map = new Map<number, string>()
  if (!Array.isArray(chapters)) return map
  for (const c of chapters) {
    if (!c) continue
    const uid = Number(c.chapterUid)
    const title = typeof c.title === 'string' ? c.title.trim() : ''
    if (!Number.isFinite(uid) || !title) continue
    map.set(uid, title)
  }
  return map
}

/**
 * 解析一条划线/笔记的章节名。
 *
 * 优先级：
 *   1. 条目自带的 `chapterTitle`（接口偶尔会给）
 *   2. 用 `chapterUid` 查章节表
 *   3. 空字符串 —— **不编造**，宁可留空也不写"未知章节"这类假值
 */
export function resolveChapterTitle(
  item: ChapterCarrier | undefined | null,
  chapterTitleMap: Map<number, string> | undefined | null,
): string {
  if (!item) return ''
  const own = typeof item.chapterTitle === 'string' ? item.chapterTitle.trim() : ''
  if (own) return own
  const uid = Number(item.chapterUid)
  if (Number.isFinite(uid) && chapterTitleMap?.has(uid)) {
    return chapterTitleMap.get(uid) as string
  }
  return ''
}

/**
 * 批量为一批条目补全章节名，返回新数组（不修改入参）。
 * 结果里每条都多一个 `resolvedChapterTitle` 字段。
 */
export function withResolvedChapterTitles<T extends ChapterCarrier>(
  items: readonly T[] | undefined | null,
  chapterTitleMap: Map<number, string> | undefined | null,
): Array<T & { resolvedChapterTitle: string }> {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    ...item,
    resolvedChapterTitle: resolveChapterTitle(item, chapterTitleMap),
  }))
}

/** 一次性把 fetchAllContent 的返回值补齐章节名 */
export function resolveWereadContent<
  B extends ChapterCarrier,
  N extends ChapterCarrier,
>(content: { bookmarks?: B[] | null; notes?: N[] | null; chapters?: WereadChapterRef[] | null } | null | undefined): {
  bookmarks: Array<B & { resolvedChapterTitle: string }>
  notes: Array<N & { resolvedChapterTitle: string }>
  chapterTitleMap: Map<number, string>
} {
  const chapterTitleMap = buildChapterTitleMap(content?.chapters)
  return {
    bookmarks: withResolvedChapterTitles(content?.bookmarks, chapterTitleMap),
    notes: withResolvedChapterTitles(content?.notes, chapterTitleMap),
    chapterTitleMap,
  }
}

/** 一条待写入 highlights 表的行（字段名 = 库里那一列） */
export interface HighlightImportRow {
  content: string
  note?: string
  chapter_title: string
  created_at: string | null
}

/**
 * 微信读书的秒级时间戳 → 可读的 ISO 串。
 *
 * 缺失、0、非数字、解析不出来一律回 `null` —— **不许回 1970-01-01**。
 * 那等于把"不知道什么时候划的"写成"2026 年之前就读到了这一句"，
 * 而笔记页与统计页都按 `created_at` 排与归日，一个假的起点会一路带进图表。
 */
export function wereadTimeIso(createTime: unknown): string | null {
  const seconds = Number(createTime)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const iso = new Date(seconds * 1000).toISOString()
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

/** 划线条目 / 笔记条目里，导入实际用到的那几个字段 */
export interface WereadMarkLike extends ChapterCarrier {
  /** 接口带回来的两个主键，导入不读它们，但声明里留着——测试喂的夹具就是这个形状 */
  bookmarkId?: string
  reviewId?: string
  markText?: string | null
  abstract?: string | null
  content?: string | null
  createTime?: number | string | null
}

/**
 * 把 fetchAllContent 的返回值规划成「要往 highlights 插的那些行」。
 *
 * ## 为什么又收一层
 * 09-16 那次只把**章节名**的解析收成一份，"一行该带哪些字段"仍然在三处各写一遍
 * （渲染层导入、主进程提取方法论前的自动导入、蒸馏知识卡片前的自动导入）。
 * 结果同一批缺陷各犯一次：两处漏 `id`（sql.js 直接拒，被 catch 咽掉后报"没有笔记"）、
 * 一处绕开章节对照表（章节名永远空）、**三处都把 `created_at` 传给了一个
 * 不认这列的 INSERT**（真实划线时间全被落成"导入那一刻"，实测 934 条只剩 9 个不同时间戳）。
 * 字段清单收在这儿，三条通路共用，以后加一列只改一处。
 */
export function planHighlightRows(
  content: { bookmarks?: WereadMarkLike[] | null; notes?: WereadMarkLike[] | null; chapters?: WereadChapterRef[] | null } | null | undefined,
): HighlightImportRow[] {
  const { bookmarks, notes } = resolveWereadContent<WereadMarkLike, WereadMarkLike>(content)
  const rows: HighlightImportRow[] = []

  for (const bm of bookmarks) {
    rows.push({
      content: String(bm.markText ?? ''),
      chapter_title: bm.resolvedChapterTitle,
      created_at: wereadTimeIso(bm.createTime),
    })
  }

  // 想法这一条有两个字段：正文是那一句被划的原文（abstract），
  // 用户自己写的想法进 note —— 少认一个就把想法正文和摘句混成一坨。
  for (const note of notes) {
    rows.push({
      content: String(note.abstract ?? ''),
      ...(note.content ? { note: String(note.content) } : {}),
      chapter_title: note.resolvedChapterTitle,
      created_at: wereadTimeIso(note.createTime),
    })
  }

  return rows
}
