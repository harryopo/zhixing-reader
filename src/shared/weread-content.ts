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

/** 「划线原文 → 真实划线时刻」对照表的产出 */
export interface ContentTimeMap {
  /** 文本 → ISO 时刻（只有全局唯一的文本才在这里） */
  times: Map<string, string>
  /** 同一句文本对应多个时刻（或对应库里多义情况）⇒ 这里列出，交给调用方**跳过** */
  ambiguous: Set<string>
}

/**
 * 建立「划线原文 → 真实时刻」的对照表，用来回填历史数据。
 *
 * ## 为什么要单独一张表
 * `highlights` 表没存微信读书的 `bookmarkId`，历史行里唯一可靠的对应关系就是**划线原文本身**
 * （导入时的去重口径也是 `(book_id, content)`，与 `backfillChapterTitles` 同一个道理）。
 *
 * ## 撞车时必须留下"这条不该猜"
 * 同一句被划了两次（很常见，同一句话在不同章节或重读时各划一次）而 `createTime` 不同 ⇒
 * 无法判断库里那一行是哪一次。**宁可不改，也不给一个编出来的时间** ——
 * 猜错会把这条划线挪到错误的一天，而统计页正是按天归集的。
 */
export function buildContentTimeMap(
  content: { bookmarks?: WereadMarkLike[] | null; notes?: WereadMarkLike[] | null } | null | undefined,
): ContentTimeMap {
  const times = new Map<string, string>()
  const ambiguous = new Set<string>()

  const offer = (text: unknown, iso: string | null): void => {
    const key = typeof text === 'string' ? text.trim() : ''
    if (!key || !iso) return
    const existing = times.get(key)
    if (existing === undefined) {
      times.set(key, iso)
      return
    }
    if (existing !== iso) {
      // 同一句对应到两个不同时刻：整条作废，不选一个
      times.delete(key)
      ambiguous.add(key)
    }
  }

  for (const bm of content?.bookmarks ?? []) {
    if (!bm) continue
    offer(bm.markText, wereadTimeIso(bm.createTime))
  }
  for (const note of content?.notes ?? []) {
    if (!note) continue
    // 想法那一行入库时正文用的是 abstract（摘句），回填就按同一个口径对
    offer(note.abstract, wereadTimeIso(note.createTime))
  }

  return { times, ambiguous }
}

/** 一条待回填的划线时间 */
export interface HighlightTimeRepair {
  id: string
  createdAt: string
}

/**
 * 规划「库里这些行该改成哪个时刻」。
 *
 * 纯函数：库里那一行（`id` / `content` / `created_at`）+ 对照表 ⇒ 要写的更新清单。
 * 不动库、不发请求，所以两条通路（启动修复、按书单本修复）可以共用同一套判定。
 */
export function planHighlightTimeRepairs(
  rows: readonly { id?: unknown; content?: unknown; created_at?: unknown }[] | null | undefined,
  map: ContentTimeMap,
): { updates: HighlightTimeRepair[]; ambiguous: number; unmatched: number } {
  let ambiguous = 0
  let unmatched = 0
  const updates: HighlightTimeRepair[] = []

  for (const row of rows ?? []) {
    const id = typeof row?.id === 'string' ? row.id : ''
    const text = typeof row?.content === 'string' ? row.content.trim() : ''
    if (!id || !text) {
      // 正文为空的行按定义对不上（没有可匹配的键），也不该反复触发重拉
      unmatched++
      continue
    }
    const target = map.times.get(text)
    if (!target) {
      if (map.ambiguous.has(text)) ambiguous++
      else unmatched++
      continue
    }
    // 已经是对的就不写：一轮修复后重复跑应当零写入
    const current = typeof row.created_at === 'string' ? toMysqlComparable(row.created_at) : ''
    if (current === toMysqlComparable(target)) continue
    updates.push({ id, createdAt: target })
  }

  return { updates, ambiguous, unmatched }
}

/** 把两种形状（`YYYY-MM-DD HH:MM:SS` / ISO）折成同一串再比，避免"已经对了还写一遍" */
function toMysqlComparable(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.includes('T')) return trimmed.slice(0, 19)
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 19).replace('T', ' ')
}
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
