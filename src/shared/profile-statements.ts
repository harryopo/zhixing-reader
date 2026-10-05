/**
 * profile-statements — 画像结论进库前的唯一一道闸（纯函数）
 *
 * ## 为什么要有这一份
 * 「画像结论」不是本应用算出来的（应用内一次 AI 都不调），是外部 AI 读语料包以后写的一份
 * 文件。文件会写错、会编、会把一条孤证写成一句关于你的定论。库里那一行一旦落成，
 * 界面上就摆着它、画像卡里就可能带着它 —— 所以**写盘之前**这一道闸只能有一个出处。
 *
 * ## 三条不许含糊
 * - **证据至少两条，且每个 id 必须真在语料包里**（语料包 id = 划线主键 / `主键#note` /
 *   消息 id / 书 id / `settings:self-profile`）。一条孤证撑不起结论（调研报告 2.5）；
 *   对不上库的 id 收了，界面上那颗「回原文」就是死链。
 * - **判定只能由本人按下**：文件里写 `verdict` 一律无效，导入的行永远落 `pending`。
 * - **重导入不许无声覆盖已有的判定**：库里已经点过「对 / 不对 / 不确定」的那条，
 *   再导一次也不动它 —— 画像是沉淀，不是一次性导出；要推翻得由本人在界面上重新按。
 *
 * 不合的那一条丢掉并计数交出去，其余照常进（知识卡片 `steps` 坏 JSON 同一降级口径）；
 * 静默丢弃是本项目反复治的形状，所以 `describeStatementImport` 必须把原因逐条说成人话。
 *
 * 纯函数：不碰 fs、不碰 electron、不发网络。
 */

/** 目前唯一有生产者的三层（`inferred` 认得但不收，见下） */
export const PROFILE_STATEMENT_LAYERS = ['said', 'marked', 'chose'] as const
/** 库里 CHECK 认的四层；`inferred` 这一层在没有应用内蒸馏之前没有生产者 */
export const PROFILE_STATEMENT_ALL_LAYERS = [...PROFILE_STATEMENT_LAYERS, 'inferred'] as const

/**
 * `inferred`（系统推断）为什么在四个地方都"认得但不收"—— 这条理由只此一份，
 * schema 的 CHECK、导入闸门、导出说明书、界面标签四处都从它派生。
 *
 * **不删这一层的理由**：它是给"以后可能出现的应用内蒸馏"留的位置，而"预留"这件事
 * 写进注释不算数，得在数据结构里认着。**现在不收的理由**：这一层语义是"系统推断"，
 * 而应用内一次 AI 都不调 ⇒ **没有生产者**；让外部 AI 往这一层写，等于把它的猜测
 * 记成"系统推断"，那是把最不可信的东西挂在最像事实的那一层上。
 *
 * ⚠️ 改这一层之前先问一句"生产者出现了没有"。真有生产者了（应用内蒸馏上线），
 * 本条与四处派生一起改，只改一处会立刻漂 —— 本项目被这件事咬过七次。
 */
/** 界面上告诉用户"为什么被挡"的那一句 —— 说明书、判据、导入提示三处都从它派生 */
export const INFERRED_REJECT_TEXT = '系统推断那一层现在不产'

/** 写进导出说明书里的那几句（`inferred` 为什么认着但不收） */
export const INFERRED_LAYER_NOTE =
  '`inferred`（系统推断）这一层在库里认着、但现在一条都不收：应用内一次 AI 都不调，没有生产者。' +
  '你写进这一层的东西会被逐条挡下并告诉你「' + INFERRED_REJECT_TEXT + '」——' +
  '结论请归到 said / marked / chose 里真正对应的那一层。'

export type StatementLayer = (typeof PROFILE_STATEMENT_ALL_LAYERS)[number]
export type StatementVerdict = 'pending' | 'confirmed' | 'rejected' | 'unsure'
export type StatementOrigin = 'app' | 'nuwa' | 'manual'

export const STATEMENT_VERDICTS: readonly StatementVerdict[] = ['pending', 'confirmed', 'rejected', 'unsure']
export const STATEMENT_ORIGINS: readonly StatementOrigin[] = ['app', 'nuwa', 'manual']

/** 画像文件交换格式：认这一份文件是不是知行导出的结论清单 */
export const STATEMENT_FILE_APP = 'zhixing-reader-profile-statements'
export const STATEMENT_FILE_VERSION = '1.0'

/**
 * 这份清单在界面上叫什么时候，导出的说明书里就写什么时候。
 * 导入弹框的筛选器名字与文档各写一遍，早晚一个说「画像结论清单」一个说「结论清单」，
 * 而对方照着文档存的文件名与界面认的名字不一致时，用户只会觉得"我明明给了它文件"。
 */
export const STATEMENT_FILE_LABEL = '画像结论清单'

/** 一条结论至少几条证据 —— 少于这个数就是孤证，孤证不立 */
export const MIN_EVIDENCE = 2

export interface StatementsFile {
  app: string
  version: string
  origin: StatementOrigin
  /** 外部工具写这份文件的那一刻（可缺，缺了不猜） */
  generatedAt?: string
  statements: unknown[]
}

/** 过了闸、可以落库的那一行（`verdict` 恒为 pending，由校验保证） */
export interface DraftStatement {
  id: string
  layer: Exclude<StatementLayer, 'inferred'>
  topic: string
  statement: string
  evidenceIds: string[]
  verdict: 'pending'
  origin: StatementOrigin
}

export type RejectReason =
  | 'not_an_object'
  | 'blank_id'
  | 'duplicate_id'
  | 'bad_layer'
  | 'inferred_disabled'
  | 'blank_statement'
  | 'blank_topic'
  | 'too_few_evidence'
  | 'unknown_evidence'

export interface RejectedStatement {
  id: string
  reason: RejectReason
}

export interface StatementValidation {
  accepted: DraftStatement[]
  rejected: RejectedStatement[]
}

/**
 * 库里那一行交出来的样子。
 *
 * `evidence_ids` 那一列存的是 JSON 文本，**解析只在数据库那一层做一次** ——
 * 界面自己 `JSON.parse` 的话，坏行会炸在渲染期；在这儿解析就能带着原因报出来。
 */
export interface ProfileStatement {
  id: string
  layer: StatementLayer
  topic: string
  statement: string
  evidenceIds: string[]
  verdict: StatementVerdict
  origin: StatementOrigin
  createdAt: string
  updatedAt: string
}

/** 界面上那颗「回原文」要的三样：原句、哪本书、能不能点回去 */
export interface EvidenceText {
  text: string
  bookId?: string
  bookTitle?: string
  /**
   * 只有出自某条划线时才有：库里那条一行的主键。
   * 不靠 `hl_` 前缀猜 —— 划线的主键规则是 `highlights` 那一层的事，
   * 而"这条证据是不是划线"由语料记录的 `kind` 说，界面只管点得回去。
   */
  highlightId?: string
}

/** 语料 id → 库里那条划线的主键（想法那条带 `#note` 后缀，去掉才对得上那一行） */
export function highlightIdOfCorpusId(id: string): string {
  return id.endsWith('#note') ? id.slice(0, -'#note'.length) : id
}

export interface StatementListView {
  statements: ProfileStatement[]
  /** 按语料 id 取的原文；库里对不上的那条不在这里，界面据此说「原始划线已不在」 */
  evidence: Record<string, EvidenceText>
}

/**
 * `profile:importStatements` 交回渲染层的那一份。
 *
 * `saved: false` 有三种，界面必须分得开：**用户取消**、**这个文件认不出是画像结论清单**、
 * **文件能读但一条都没过闸** —— 都算"没导"就说不准下一句该写什么
 * （与 `CorpusExportResult` 同一口径，本项目反复治的"两种失败共用一个形状"）。
 */
export type StatementImportReason = 'canceled' | 'bad_file' | 'nothing_accepted'

export interface StatementImportResult {
  saved: boolean
  /** 无论成功、取消、读不懂、一条没过闸，都是一句人话 */
  summary: string
  reason?: StatementImportReason
  /** 真进了库的条数（0 时 `saved` 必为 false） */
  written: number
}

/** 落库前的合并结果：`toWrite` 是要写的，`protectedIds` 是因为本人已判而不动的 */
export interface StatementWritePlan {
  toWrite: DraftStatement[]
  protectedIds: string[]
  rejected: RejectedStatement[]
}

const REASON_TEXT: Record<RejectReason, string> = {
  not_an_object: '那一条形状不对（不是结论对象）',
  blank_id: '没给编号',
  duplicate_id: '编号重复',
  bad_layer: '层名不认识',
  inferred_disabled: INFERRED_REJECT_TEXT,
  blank_statement: '结论正文是空的',
  blank_topic: '没写话题',
  too_few_evidence: '证据不足两条',
  unknown_evidence: '对不上你的语料',
}

/** 界面上的层标签：与语料包那句口径同源（`describeCorpus` 说的是"我说的 / 我挑的 / 我选的"） */
export const STATEMENT_LAYER_LABELS: Record<StatementLayer, string> = {
  said: '我说',
  marked: '我挑',
  chose: '我选',
  inferred: '系统推断',
}

const trim = (val: unknown): string => String(val ?? '').trim()

/** `said / marked / chose` 之外一律不收（`inferred` 在上面单独挡，理由不同） */
function knownLayer(value: string): Exclude<StatementLayer, 'inferred'> | null {
  return (PROFILE_STATEMENT_LAYERS as readonly string[]).includes(value)
    ? (value as Exclude<StatementLayer, 'inferred'>)
    : null
}

const BAD_FILE_TEXT: Record<ParseFailure['reason'], string> = {
  bad_json: '这份文件不是合法的 JSON · 库里什么都没改',
  wrong_app: '这份文件不是知行读书的画像结论清单 · 库里什么都没改',
  bad_version: '这份文件的格式版本比本应用还新 · 先升级再导，不猜着读',
  bad_origin: '这份文件没写清结论出自哪条通路（只认 app / nuwa / manual）',
  bad_statements: '这份文件里的结论清单不是一个列表',
}

/** 认不出文件时说的那句：原因给到人话，不把内部键名摊到界面上 */
export function describeBadFile(reason: ParseFailure['reason']): string {
  return BAD_FILE_TEXT[reason] ?? '这份文件读不出结论清单'
}

/** 落库主键带来源命名空间：同一编号来自不同来源（外部蒸馏 / 手工整理）不互相顶掉 */
export function statementRowId(origin: StatementOrigin, extId: string): string {
  return `${origin}:${extId}`
}

export type ParseFailure = {
  ok: false
  reason: 'bad_json' | 'wrong_app' | 'bad_version' | 'bad_origin' | 'bad_statements'
}
export type ParseResult = { ok: true; file: StatementsFile } | ParseFailure

/**
 * 只认这一种文件；认不出的一律拒收，**不演成「这份文件没有结论」**。
 * 版本比程序还新时也拒 —— 猜着读会把新字段当成没有。
 */
export function parseStatementsFile(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'bad_json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'wrong_app' }
  const doc = raw as Record<string, unknown>
  if (trim(doc.app) !== STATEMENT_FILE_APP) return { ok: false, reason: 'wrong_app' }
  if (trim(doc.version) !== STATEMENT_FILE_VERSION) return { ok: false, reason: 'bad_version' }
  const origin = trim(doc.origin) as StatementOrigin
  if (!STATEMENT_ORIGINS.includes(origin)) return { ok: false, reason: 'bad_origin' }
  if (!Array.isArray(doc.statements)) return { ok: false, reason: 'bad_statements' }
  const generatedAt = trim(doc.generatedAt)
  const file: StatementsFile = {
    app: STATEMENT_FILE_APP,
    version: STATEMENT_FILE_VERSION,
    origin,
    ...(generatedAt ? { generatedAt } : {}),
    statements: doc.statements,
  }
  return { ok: true, file }
}

/**
 * 证据列只收**字符串**并去重。数字 / null 不掰成 id ——
 * `String(42)` 会变成一条从没有过的引用，报出来的原因就成了假话。
 */
function cleanEvidence(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  const out: string[] = []
  for (const item of val) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * 逐条过闸。`origin` 是文件的来源（决定落库主键的前缀），默认 `nuwa`（外部蒸馏那条通路）。
 * 分母不变量：每一条要么进 `accepted`、要么进 `rejected`，不漏不重。
 */
export function validateStatements(
  statements: readonly unknown[],
  knownEvidenceIds: ReadonlySet<string>,
  origin: StatementOrigin = 'nuwa',
): StatementValidation {
  const accepted: DraftStatement[] = []
  const rejected: RejectedStatement[] = []
  const seen = new Set<string>()

  for (const item of statements) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rejected.push({ id: '(缺 id)', reason: 'not_an_object' })
      continue
    }
    const row = item as Record<string, unknown>
    const extId = trim(row.id)
    if (!extId) {
      rejected.push({ id: '(缺 id)', reason: 'blank_id' })
      continue
    }
    if (seen.has(extId)) {
      rejected.push({ id: extId, reason: 'duplicate_id' })
      continue
    }
    seen.add(extId)

    const layer = trim(row.layer)
    if (layer === 'inferred') {
      // 这一层说的是"系统推断出来的你"。应用内不调 AI，所以此刻没有任何生产者；
      // 收进来就是让外部工具替我们造一层本来就空的证据。库里留着这个取值是给以后的。
      rejected.push({ id: extId, reason: 'inferred_disabled' })
      continue
    }
    const layerOk = knownLayer(layer)
    if (!layerOk) {
      rejected.push({ id: extId, reason: 'bad_layer' })
      continue
    }

    const statement = trim(row.statement)
    if (!statement) {
      rejected.push({ id: extId, reason: 'blank_statement' })
      continue
    }
    const topic = trim(row.topic)
    if (!topic) {
      rejected.push({ id: extId, reason: 'blank_topic' })
      continue
    }

    const evidenceIds = cleanEvidence(row.evidenceIds)
    if (evidenceIds.length < MIN_EVIDENCE) {
      rejected.push({ id: extId, reason: 'too_few_evidence' })
      continue
    }
    if (!evidenceIds.every((id) => knownEvidenceIds.has(id))) {
      rejected.push({ id: extId, reason: 'unknown_evidence' })
      continue
    }

    accepted.push({
      id: statementRowId(origin, extId),
      layer: layerOk,
      topic,
      statement,
      evidenceIds,
      // 文件里写了 verdict 也不接：那一格只有本人在界面上按下才算
      verdict: 'pending',
      origin,
    })
  }

  return { accepted, rejected }
}

/**
 * 与库里已有的行合并：本人已经判过的那条**不动**（连正文都不覆盖 —— 覆盖正文等于
 * 让一个没按过的动作推翻按过的），其余按主键替换。
 */
export function mergeStatementsForWrite(
  accepted: readonly DraftStatement[],
  existingVerdictById: Readonly<Record<string, { verdict: StatementVerdict }>>,
): Pick<StatementWritePlan, 'toWrite' | 'protectedIds'> {
  const toWrite: DraftStatement[] = []
  const protectedIds: string[] = []
  for (const row of accepted) {
    const existing = existingVerdictById[row.id]
    if (existing && existing.verdict !== 'pending') {
      protectedIds.push(row.id)
      continue
    }
    toWrite.push(row)
  }
  return { toWrite, protectedIds }
}

/** 界面上那一句：写了几条、为什么其余的没进来、你判过的那几条没动 */
export function describeStatementImport(plan: StatementWritePlan): string {
  if (!plan.toWrite.length && !plan.protectedIds.length && !plan.rejected.length) {
    return '这个文件里没有一条能用 · 库里什么都没改'
  }
  const head = plan.toWrite.length ? `收下 ${plan.toWrite.length} 条画像结论` : '一条都没收下'
  const untouched = plan.protectedIds.length
  const dropped = plan.rejected.length + untouched
  if (!dropped) return head

  const byReason = new Map<RejectReason, number>()
  for (const item of plan.rejected) byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1)
  const reasons = [...byReason.entries()].map(([reason, count]) => `${REASON_TEXT[reason] ?? '原因不认识'} ${count} 条`)
  const kept = untouched ? ` · 你已经判过的 ${untouched} 条保持原样` : ''
  const detail = reasons.length ? reasons.join('、') : '上面那几条是你判过的'
  return `${head} · ${dropped} 条没动或没收：${detail}${kept}`
}
