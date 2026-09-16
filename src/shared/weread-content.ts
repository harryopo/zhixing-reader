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
