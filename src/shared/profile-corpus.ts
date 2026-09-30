/**
 * profile-corpus — 阅读画像语料的「分层规划」
 *
 * ## 为什么要有这一份
 * 画像要让外部 AI 读，第一件事不是总结，是**把「谁说的话」分清楚**：
 * 划线的正文是**作者写的句子**，想法那一列才是**你自己写的字**。混在一层，
 * 外部 AI 会把《当下的力量》里的话当成你的观点引用回去（这是本次调研里四路独立
 * 收敛到的同一条风险：R1）。所以这里规划出来的每一条都自带 `layer`，
 * 往下无论走导出、进核验、还是拼画像卡，都不许再重新判一次层 —— 判一次漂一次。
 *
 * ## 三条不许含糊的口径
 * - **R1**：`highlights.content` → `marked`、`highlights.note` → `said`。同一条划线
 *   既有正文又有想法时产出**两条**记录，id 不同（想法那条带 `#note` 后缀），
 *   这样外部 AI 回指过来时还能对上库里那一行。
 * - **R2**：`memories` 整张表都不进语料。它的 `insight` 生产代码抓的是 **AI 回复里**
 *   那 20–50 字，`preference` 抓的是**你发的消息里**的片段 —— 两者都是系统抽取物，
 *   不是你亲手写下的一句话（GitHub #33）。把抽取物说成「你声明过的偏好」，
 *   等于让 AI 引用它自己的产物给你画像。丢弃，但**逐条计数交出去**，不静默。
 * - **R3**：`books.category` 是微信读书的标签体系，不是你选的词。`chose` 层每条
 *   必须带 `caveat`，这句话丢了判红。
 *
 * 时间走 `db-time.ts` 那一把尺（库里那一串是不带时区标记的 UTC 墙上时钟，
 * 直接 `new Date(...)` 会在 UTC+8 上早 8 小时），这里不再写第二份解析。
 *
 * 纯函数：只依赖 `./db-time`，不碰 electron / fs / 网络。
 */
import { parseDbTime } from './db-time'

/** 语料里真正出现的层。`inferred`（系统推断）第 3 批才产，默认不产 */
export const PROFILE_LAYERS = ['said', 'marked', 'chose'] as const
export type ProfileLayer = (typeof PROFILE_LAYERS)[number]

/** 这条记录是从哪张表的哪一列来的 —— 回指与排错都靠它 */
export type CorpusKind = 'highlight_note' | 'user_message' | 'self' | 'highlight' | 'book' | 'daily'

/** R3：平台分类不是本人的标签，这句话每次导出都得跟着走 */
export const CATEGORY_CAVEAT = '分类来自微信读书平台标签体系，不是你选的词'

/** 自述资料没有表主键，用它 —— 导出的语料里 id 必须每次导出都稳定 */
export const SELF_RECORD_ID = 'settings:self-profile'

export interface CorpusRecord {
  id: string
  layer: ProfileLayer
  kind: CorpusKind
  text: string
  /** 真实时刻，带 `Z` 的 ISO；库里解不出来就是 null（不猜 1970，也不填"此刻"） */
  at: string | null
  bookId?: string
  bookTitle?: string
  chapterTitle?: string
  /** 只有 chose 层带（R3）；其他层连这个键都不该出现 */
  caveat?: string
}

export interface CorpusSelfProfile {
  nickname: string
  location: string
  bio: string
}

export interface CorpusInput {
  /** `highlightsDb.getAll()` 的形状：h.* 加 JOIN 出来的 book_title */
  highlights: Record<string, unknown>[]
  /** `booksDb.getAll()` */
  books: Record<string, unknown>[]
  /** `chat_messages` 里 role='user' 的行 */
  userMessages: Record<string, unknown>[]
  /** `memoriesDb.getAll()`：本函数只读它的 `type`，一类都不进语料（R2） */
  memories: Record<string, unknown>[]
  /** `dailyStatsDb.getRange(...)` */
  dailyStats: Record<string, unknown>[]
  selfProfile: CorpusSelfProfile | null
  /** 每本被划了多少条，由调用方一次 SQL 汇总后传进来（不在这儿翻库） */
  highlightCountsByBook?: Record<string, number>
}

export interface CorpusPlan {
  records: CorpusRecord[]
  /** 被丢掉的那些，按原因归类计数 —— 静默丢弃是本项目反复治的形状 */
  dropped: Record<string, number>
}

const trim = (val: unknown): string => String(val ?? '').trim()

/**
 * 出处那三栏：**没有就整个键不出现**，而不是留一个值为 undefined 的键。
 * 写 `bookTitle: trim(x) || undefined` 也能让 JSON 落盘时丢掉它，但内存里那个键还在 ——
 * 于是 `JSON.parse(JSON.stringify(r))` 与 `r` 不再是同一个形状，判据看不出来，
 * 而下游谁做一次 `Object.keys()` 就会多出一个从没值的键。
 */
function sources(row: Record<string, unknown>): Partial<CorpusRecord> {
  const out: Partial<CorpusRecord> = {}
  const bookId = trim(row.book_id)
  const bookTitle = trim(row.book_title)
  const chapterTitle = trim(row.chapter_title)
  if (bookId) out.bookId = bookId
  if (bookTitle) out.bookTitle = bookTitle
  if (chapterTitle) out.chapterTitle = chapterTitle
  return out
}

/** 库里那一串 → 带 Z 的 ISO；解不出来交回 null，让界面与语料都别说假时刻 */
function iso(val: unknown): string | null {
  const parsed = parseDbTime(val)
  return parsed ? parsed.toISOString() : null
}

function saidText(highlights: Record<string, unknown>[], messages: Record<string, unknown>[], self: CorpusSelfProfile | null, dropped: Record<string, number>): CorpusRecord[] {
  const rows: CorpusRecord[] = []
  for (const h of highlights) {
    const note = trim(h.note)
    if (!note) {
      // 正文与想法都空 = 库里那 8 条空白行的形状；只有正文没想法的不算丢弃
      if (!trim(h.content)) dropped.blank = (dropped.blank ?? 0) + 1
      continue
    }
    const id = trim(h.id)
    if (!id) continue
    rows.push({
      id: `${id}#note`,
      layer: 'said',
      kind: 'highlight_note',
      text: note,
      at: iso(h.created_at),
      ...sources(h),
    })
  }
  for (const m of messages) {
    const content = trim(m.content)
    if (!content) {
      dropped.blank_message = (dropped.blank_message ?? 0) + 1
      continue
    }
    const id = trim(m.id)
    if (!id) continue
    rows.push({ id, layer: 'said', kind: 'user_message', text: content, at: iso(m.created_at) })
  }
  const selfText = selfProfileText(self)
  if (selfText) rows.push({ id: SELF_RECORD_ID, layer: 'said', kind: 'self', text: selfText, at: null })
  return rows
}

/** 三项各截断过（服务层那一份已经截 200 字），这里只拼真填了的，全空就不产记录 */
function selfProfileText(self: CorpusSelfProfile | null): string {
  if (!self) return ''
  const parts: string[] = []
  if (self.nickname.trim()) parts.push(`昵称：${self.nickname.trim()}`)
  if (self.location.trim()) parts.push(`所在地：${self.location.trim()}`)
  if (self.bio.trim()) parts.push(`简介：${self.bio.trim()}`)
  return parts.join(' · ')
}

function markedRows(highlights: Record<string, unknown>[]): CorpusRecord[] {
  const rows: CorpusRecord[] = []
  for (const h of highlights) {
    const content = trim(h.content)
    if (!content) continue
    const id = trim(h.id)
    if (!id) continue
    rows.push({
      id,
      layer: 'marked',
      kind: 'highlight',
      text: content,
      at: iso(h.created_at),
      // 章节名只做出处，不参与任何判定（接口经常不给，给了也可能是空的）
      ...sources(h),
    })
  }
  return rows
}

function bookRow(b: Record<string, unknown>, markedCount: number): CorpusRecord {
  const title = trim(b.title)
  const parts = [`《${title || '（无书名）'}》`]
  if (trim(b.author)) parts.push(`作者：${trim(b.author)}`)
  if (trim(b.publisher)) parts.push(`出版：${trim(b.publisher)}`)
  if (trim(b.category)) parts.push(`平台分类：${trim(b.category)}`)
  parts.push(`读了 ${Math.round(Number(b.reading_progress ?? 0) * 100)}%`)
  parts.push(`划了 ${markedCount} 条`)
  return {
    id: trim(b.id),
    layer: 'chose',
    kind: 'book',
    text: parts.join(' · '),
    at: iso(b.last_read_time),
    bookId: trim(b.id),
    bookTitle: title || undefined,
    caveat: CATEGORY_CAVEAT,
  }
}

function choseRows(books: Record<string, unknown>[], daily: Record<string, unknown>[], counts: Record<string, number>, dropped: Record<string, number>): CorpusRecord[] {
  // 一本没划的书也是「你选的」证据 —— 调研里那条「82 本一条没划」必须出现在画像里，
  // 所以这里**不筛掉**没划线的书，只把条数如实写成 0。
  const rows = books.filter((b) => trim(b.id)).map((b) => bookRow(b, counts[trim(b.id)] ?? 0))
  for (const d of daily) {
    const id = trim(d.id)
    if (!id) continue
    const minutes = Math.round(Number(d.reading_time ?? 0) / 60)
    const highlightsAdded = Number(d.highlights_added ?? 0)
    const reviewed = Number(d.cards_reviewed ?? 0)
    if (!minutes && !highlightsAdded && !reviewed) {
      dropped.no_activity = (dropped.no_activity ?? 0) + 1
      continue
    }
    const day = trim(d.date)
    rows.push({
      id,
      layer: 'chose',
      kind: 'daily',
      text: `${day} 读了 ${minutes} 分钟 · 划了 ${highlightsAdded} 条 · 复习 ${reviewed} 张`,
      // 日期串没有"哪一刻"：库里那一列按 UTC 日归集（本项目的已知两套口径），
      // 补一个 00:00:00 会变成一个从没发生过的时刻 —— 交回 null，日子写在 text 里
      at: null,
      caveat: '这一天读没读是系统按当天有没有记录判的，不是你自己报的',
    })
  }
  return rows
}

/**
 * R2 + #33：`memories` 整张表不进语料，但**一类都不许静默**。
 * 只数不搬 —— 计数交给 manifest 与界面，让「少了 4 条」这件事看得见。
 */
function countDroppedMemories(memories: Record<string, unknown>[], dropped: Record<string, number>): void {
  for (const m of memories) {
    const type = trim(m.type)
    if (type === 'insight' || type === 'preference') {
      dropped[type] = (dropped[type] ?? 0) + 1
    }
  }
}

/** 把「这一层有多少条、多少字」算成人话；一条都没有时说的那句不许是「导出成功 0 条」 */
export function describeCorpus(plan: CorpusPlan): string {
  if (plan.records.length === 0) return '没有可导出的痕迹 · 先去读书或划几句，再来导出'
  const byLayer = (layer: ProfileLayer) => plan.records.filter((r) => r.layer === layer)
  const chars = (layer: ProfileLayer) => byLayer(layer).reduce((sum, r) => sum + r.text.length, 0)
  const head = [
    `我说的 ${byLayer('said').length} 条（${chars('said')} 字）`,
    `我挑的 ${byLayer('marked').length} 条（${chars('marked')} 字）`,
    `我选的 ${byLayer('chose').length} 条`,
  ].join(' · ')
  const droppedMemory = (plan.dropped.insight ?? 0) + (plan.dropped.preference ?? 0)
  if (!droppedMemory) return head
  return `${head}（另有 ${droppedMemory} 条系统从对话里抽的记忆没算进来：AI 的话与半句抽取都不是你说的话）`
}

/**
 * 分卷：外部 AI 一次喂不下整层（marked 实测 5.6 万字），按每卷 ≤maxChars 字切开。
 * 单条就超上限的那些自己占一卷 —— 不截断、不丢条目（丢了就不是证据库了）。
 */
export function splitIntoVolumes(records: readonly CorpusRecord[], maxChars: number): CorpusRecord[][] {
  const volumes: CorpusRecord[][] = []
  let current: CorpusRecord[] = []
  let used = 0
  for (const record of records) {
    const size = record.text.length
    if (current.length > 0 && used + size > maxChars) {
      volumes.push(current)
      current = []
      used = 0
    }
    current.push(record)
    used += size
  }
  if (current.length > 0) volumes.push(current)
  return volumes
}

/** 一卷的字数（分卷与 manifest 共用，不在两处各算一遍） */
export function volumeChars(records: readonly CorpusRecord[]): number {
  return records.reduce((sum, r) => sum + r.text.length, 0)
}

export interface CorpusVolume {
  /** 文件名由这一处定，主进程只按它写盘 —— 两处各拼一次迟早漂 */
  file: string
  layer: ProfileLayer
  records: CorpusRecord[]
}

/**
 * 每卷的上限（字）。marked 层本机实测 56,299 字，一次喂进去既超常见上下文，
 * 也正是 OP-Bench 测出「记忆反而拖垮表现」的那种用法 —— 所以按卷切，让人挑着贴。
 * 这个数同时被导出那侧与交接说明用（说明里要告诉对方每卷多大），所以只有这一处。
 */
export const CORPUS_MAX_CHARS_PER_VOLUME = 4000

/**
 * 按层分卷：said / marked / chose 各自切，文件名带层名。
 * 单层只有一卷时也叫 `-vol-01`，不为省一个字再分两种命名。
 */
export function planVolumes(records: readonly CorpusRecord[], maxChars: number): CorpusVolume[] {
  const out: CorpusVolume[] = []
  for (const layer of PROFILE_LAYERS) {
    const rows = records.filter((r) => r.layer === layer)
    splitIntoVolumes(rows, maxChars).forEach((volume, i) => {
      out.push({ file: `${layer}-vol-${String(i + 1).padStart(2, '0')}.jsonl`, layer, records: volume })
    })
  }
  return out
}

export function planCorpusRecords(input: CorpusInput): CorpusPlan {
  const dropped: Record<string, number> = {}
  countDroppedMemories(input.memories, dropped)
  const said = saidText(input.highlights, input.userMessages, input.selfProfile, dropped)
  const marked = markedRows(input.highlights)
  const counts = input.highlightCountsByBook ?? {}
  const chose = choseRows(input.books, input.dailyStats, counts, dropped)
  return { records: [...said, ...marked, ...chose], dropped }
}
