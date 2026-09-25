/**
 * review-sources — 复习队列里"一张卡来自哪里、问什么、答什么"的唯一口径
 *
 * 队列原本只装划线。知识卡片与方法论是花了 AI 钱生成的，此前只能看不能复习，
 * 生成完就躺在页面里等遗忘。把它们放进来之后，"正面问什么、背面答什么"就成了
 * 一份要收住的口径：主进程组装队列、渲染层展示、测试断言，三处都从这里读。
 *
 * 来源在库里有三种存法（`cards` 表三个可空外键列，见 database/schema.ts）：
 * 这里只认一个判别联合，谁也不许自己拼 `highlight_id ?? knowledge_card_id`。
 */

export type ReviewSourceKind = 'highlight' | 'knowledge_card' | 'methodology'

export interface ReviewSourceRef {
  kind: ReviewSourceKind
  id: string
}

/** 界面上给用户的叫法（不许出现第二套名字） */
export const REVIEW_SOURCE_LABELS: Record<ReviewSourceKind, string> = {
  highlight: '划线',
  knowledge_card: '知识卡片',
  methodology: '方法论',
}

/** 每种来源对应的 cards 列名 —— 查询、写入与迁移共用这一份映射 */
export const REVIEW_SOURCE_COLUMNS: Record<ReviewSourceKind, string> = {
  highlight: 'highlight_id',
  knowledge_card: 'knowledge_card_id',
  methodology: 'methodology_id',
}

export const REVIEW_SOURCE_KINDS = Object.keys(REVIEW_SOURCE_COLUMNS) as ReviewSourceKind[]

export function isReviewSourceKind(value: unknown): value is ReviewSourceKind {
  return typeof value === 'string' && (REVIEW_SOURCE_KINDS as string[]).includes(value)
}

/** cards 表里三种来源的列名（驼峰版，对应 Card 对象上的字段名） */
const CAMEL_FIELDS: Record<ReviewSourceKind, 'highlightId' | 'knowledgeCardId' | 'methodologyId'> = {
  highlight: 'highlightId',
  knowledge_card: 'knowledgeCardId',
  methodology: 'methodologyId',
}

/** 带来源字段的东西（Card 对象、或任何有这三个字段的形状） */
export interface CardSourceFields {
  highlightId?: string | null
  knowledgeCardId?: string | null
  methodologyId?: string | null
}

/** 从 Card 对象上读出唯一来源 */
export function cardSourceOf(card: CardSourceFields): ReviewSourceRef | null {
  for (const kind of REVIEW_SOURCE_KINDS) {
    const id = card[CAMEL_FIELDS[kind]]
    if (typeof id === 'string' && id !== '') return { kind, id }
  }
  return null
}

/** 从 cards 的一行里读出它唯一的来源；三列全空 = 数据是坏的，如实返回 null */
export function reviewSourceOfCardRow(row: Record<string, unknown>): ReviewSourceRef | null {
  for (const kind of REVIEW_SOURCE_KINDS) {
    const id = row[REVIEW_SOURCE_COLUMNS[kind]]
    if (typeof id === 'string' && id !== '') return { kind, id }
  }
  return null
}

/** 组装一张卡所需的原始片段：由主进程的 JOIN 结果提供，这里只决定怎么说 */
export interface ReviewCardParts {
  kind: ReviewSourceKind
  /** 来源的主文本：划线原文 / 卡片正文 / 方法论说明 */
  content: string
  /** 来源的标题：卡片标题 / 方法论名称；划线没有标题 */
  title: string | null
  /** 次级文本：卡片解读 / 方法论步骤（划线不用） */
  extra: string | null
  /** 出处副行：章节名 / 触发场景 */
  context: string | null
  bookTitle: string | null
}

export interface ReviewCardView {
  label: string
  /** 正面：先回想的东西 */
  front: string
  /** 背面主答案；确实没有独立答案时为 null（界面退到只显出处） */
  back: string | null
  /** 背面的补充说明，整句拼好；没有就 null */
  detail: string | null
  /** 出处那一行；量不到书名就 null，界面不摆「出处：未知书籍」 */
  sourceLine: string | null
}

/**
 * FSRS 调度状态在队列里的形状（跨进程）。
 *
 * 与 electron/fsrs-engine.ts 的 `Card` 字段一致，但**不 import 它** —— 那个模块要拉
 * ts-fsrs，preload 与渲染层都不能碰。两边各写一份迟早漂（ReviewStats 就漂过），
 * 所以 `tests/review-queue-contract.test.ts` 拿主进程真实返回的键集合对账钉住。
 */
export interface ReviewCardFields {
  id: string
  state: number
  step: number
  stability: number
  difficulty: number
  due: string
  lastReview: string | null
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  /** 三种来源各一个可空字段，一张卡有且只有一个非空（与 cards 表的 CHECK 同源） */
  highlightId: string | null
  knowledgeCardId?: string | null
  methodologyId?: string | null
  bookId?: string
}

/** 复习队列交给界面用的一整张卡 */
export interface DueReviewCardView extends ReviewCardFields, ReviewCardView {
  sourceKind: ReviewSourceKind
  sourceId: string
  bookId: string
  bookTitle: string | null
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/**
 * methodologies.steps 在库里存的是 JSON 数组字符串（写入方 JSON.stringify）。
 * 复习卡背面要的是能读的一段话：
 *   - 解析成数组 → 按 1./2./3. 排版；
 *   - 解析成一个字符串（写入方把一个字符串喂了进来）→ 去掉那层引号；
 *   - 解析不了（纯文本、坏 JSON）→ 原样给出。
 * 三种情况都不许把内容弄丢。
 */
export function formatStepList(raw: string | null): string | null {
  const text = trimmed(raw)
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      const steps = parsed.map((item) => trimmed(String(item ?? ''))).filter((s) => s !== '')
      return steps.length > 0 ? steps.map((s, i) => `${String(i + 1)}. ${s}`).join('\n') : null
    }
    if (typeof parsed === 'string') return trimmed(parsed) || null
  } catch {
    /* 不是 JSON：按纯文本处理 */
  }
  return text
}

/** 一句话说清每张卡问什么：
 * 划线问"当时为什么划它"（原文在前，自己的笔记当答案）；
 * 知识卡片问"这个概念说了什么"（标题在前，正文当答案）；
 * 方法论问"什么时候用、怎么用"（名称+触发场景在前，步骤当答案）。
 */
export function buildReviewCardView(parts: ReviewCardParts): ReviewCardView {
  const book = trimmed(parts.bookTitle)
  const sourceLine = book
    ? trimmed(parts.context)
      ? `《${book}》 · ${trimmed(parts.context)}`
      : `《${book}》`
    : null
  const label = REVIEW_SOURCE_LABELS[parts.kind]

  if (parts.kind === 'knowledge_card') {
    const title = trimmed(parts.title)
    return {
      label,
      front: title || trimmed(parts.content),
      back: title ? trimmed(parts.content) : null,
      detail: trimmed(parts.extra) ? `解读：${trimmed(parts.extra)}` : null,
      // 卡片的出处就是这本书；章节名这一维对卡片没有意义，不带
      sourceLine: book ? `《${book}》` : null,
    }
  }

  if (parts.kind === 'methodology') {
    const name = trimmed(parts.title)
    const trigger = trimmed(parts.context)
    const steps = trimmed(parts.extra)
    const description = trimmed(parts.content)
    return {
      label,
      front: trigger ? `${name || description} · 什么时候用：${trigger}` : name || description,
      // 有步骤就考步骤，没有步骤退而考它是什么
      back: steps || (name ? description : null),
      detail: steps && name && description ? `它是什么：${description}` : null,
      sourceLine: book ? `《${book}》` : null,
    }
  }

  const note = trimmed(parts.extra)
  return {
    label,
    front: trimmed(parts.content),
    back: note || null,
    detail: null,
    sourceLine,
  }
}
