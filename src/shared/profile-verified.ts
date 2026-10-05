/**
 * profile-verified — 「你已经判过什么」的那一份清单
 *
 * ## 为什么必须有它
 *
 * 语料包导出的是**证据**（划线原句、你写的想法、你选过的书），而外部 AI 从证据推出的
 * **结论**存在本机 `profile_statements` 里 —— 那一表**从来不进导出包**。后果是：
 * 第二轮拿到的包与第一轮一模一样，外部 AI **不知道你已经认可过哪些结论**，
 * 于是从零重新推断；它新写的与你按过「对」的那些混在一起交回，你得逐条重新判一遍。
 * 每轮都在重复劳动，而上一轮按过的「对」这个信号**一次都没被用上**。
 *
 * 这份文件就是把那个信号搬出去：外部 AI 拿到的是「**这批结论你已经认过了**」，
 * 于是第二轮该做的是**增量修正**而不是重写。
 *
 * ## 形状为什么复用现有 id 空间
 *
 * `id` 直接用 `profile_statements` 的主键，**不给它重新编号** —— 那样闸门
 * （`mergeStatementsForWrite` 靠 id 命中"已判过就不动"）就认不出来了，
 * 外部 AI 把已确认的那条原样交回会被当成新条目收下。复用 id 空间是这个设计的全部要点。
 *
 * ## 纯函数
 *
 * 不碰 fs、不碰 electron、不发网络，时钟由调用方给。`buildVerified` 只做三件事：
 * 挑出判「对」的、保证字段齐全、把判据一句人话写在文件里。
 */
import type { StatementLayer } from './profile-statements'
import { PROFILE_STATEMENT_LAYERS, MIN_EVIDENCE } from './profile-statements'

/** 已确认的一条结论。字段与 `DraftStatement` 对齐，差别只有 `verdict` 恒为 confirmed */
export interface VerifiedStatement {
  /** 与 `profile_statements` 同一套 id —— 复用 id 空间，闸门才认得出"这条已确认过" */
  id: string
  layer: Exclude<StatementLayer, 'inferred'>
  topic: string
  statement: string
  evidenceIds: string[]
  /** 恒为 'confirmed'；写出来是为了让对方不必猜这个文件是什么 */
  verdict: 'confirmed'
}

export interface VerifiedFile {
  app: string
  version: string
  /** 导出那一刻 —— 语料与判定都会随你的动作变，这一行说明它是哪一刻的快照 */
  generatedAt: string
  /** 零条也要写出来：一份空清单与"这份文件不存在"对外面的人不是一回事 */
  confirmed: number
  statements: VerifiedStatement[]
}

/** 与语料包同一个 app 标记（同一份工具产出，靠一个名字认出亲缘） */
export const VERIFIED_FILE_APP = 'zhixing-reader-profile-verified'
export const VERIFIED_FILE_VERSION = '1.0'
export const VERIFIED_FILE_NAME = 'verified.json'

const trim = (val: unknown): string => String(val ?? '').trim()

/**
 * 库里那一行（`profileStatementsDb.getAll()` 的形状）—— 只声明这份文件要用的字段，
 * 其余列（created_at / updated_at / origin）靠真实行透传，不在这里重声明一份。
 */
export interface StatementRowLike {
  id: string
  layer: string
  topic: string
  statement: string
  evidenceIds: string[]
  verdict: string
  origin?: string
}

/**
 * ⚠️ **导出的 id 必须剥掉来源命名空间前缀。**
 *
 * 库里的主键是 `statementRowId(origin, extId)` = `` `${origin}:${extId}` ``（见
 * profile-statements.ts）—— 同一个编号来自不同来源不互相顶掉，这是刻意设计。
 * 而导入闸门做的正是同一个换算：外部文件里的 `v1` 落库成 `nuwa:v1`。
 *
 * 所以这份文件里写的必须是 **`v1` 而不是 `nuwa:v1`**：写成后者，对方原样交回后
 * 闸门会再加一次前缀变成 `nuwa:nuwa:v1` —— 那是一条**新条目**，你以为在更新、
 * 库里却多了一条，`protectedIds` 那一路保护整个走不到。**这一格差一个前缀。**
 */
function externalIdOf(row: StatementRowLike, origin: string): string {
  const prefix = `${origin}:`
  return trim(row.id).startsWith(prefix) ? trim(row.id).slice(prefix.length) : trim(row.id)
}

/**
 * 只收判「对」且字段齐全的。**证据不足两条的已确认条目照样导出** ——
 * 那是你自己按下的键，它是真的判断；此时不许导出反而是"系统替你撤销一次判定"。
 * 但字段残缺的那条要丢掉（外部 AI 读到半条只会当噪声）。
 */
export function buildVerified(rows: readonly StatementRowLike[], now: Date): VerifiedFile {
  const statements: VerifiedStatement[] = []
  for (const row of rows) {
    if (trim(row.verdict) !== 'confirmed') continue
    const layer = trim(row.layer)
    const statement = trim(row.statement)
    const topic = trim(row.topic)
    const evidenceIds = (row.evidenceIds ?? []).map(trim).filter(Boolean)
    // 没给 origin 就按库里 id 的前缀反推不出来 —— 这时用整串（它本来就是 extId）
    const id = externalIdOf(row, trim(row.origin))
    if (!id || !statement || !topic || evidenceIds.length < MIN_EVIDENCE) continue
    if (!(PROFILE_STATEMENT_LAYERS as readonly string[]).includes(layer)) continue
    statements.push({
      id,
      layer: layer as VerifiedStatement['layer'],
      topic,
      statement,
      evidenceIds,
      verdict: 'confirmed',
    })
  }
  // 按 id 排序：导出是快照，顺序不稳的话两次导出同一份数据会逐字不同，
  // 外面的人无法判断"这次到底变了什么"。
  statements.sort((a, b) => a.id.localeCompare(b.id))
  return {
    app: VERIFIED_FILE_APP,
    version: VERIFIED_FILE_VERSION,
    generatedAt: now.toISOString(),
    confirmed: statements.length,
    statements,
  }
}

/** 写进交接说明里的那几句 —— 与 `buildVerified` 同处一份，不许各写一遍 */
export function verifiedSection(verified: VerifiedFile): string {
  if (verified.confirmed === 0) {
    return [
      '## 已确认的结论：这一批是空的',
      '',
      `${VERIFIED_FILE_NAME} 里 \`confirmed\` 是 0 —— 你还没在这个应用里对任何一条按下过「对」。`,
      '这一轮就是第一轮：下面那批证据还没被任何结论覆盖，正常推断即可。',
    ].join('\n')
  }
  return [
    `## 已确认的结论（\`${VERIFIED_FILE_NAME}\`，${verified.confirmed} 条）`,
    '',
    '**这批是你已经按下过「对」的。** 它们是你的判断，不是你的猜测 —— 下面这一轮请：',
    '',
    '- **不要重复提**同一件事。已经在清单里的，除非证据变了（`evidenceIds` 变了），否则不必再写一遍。',
    `- **${VERIFIED_FILE_NAME} 里那 \`id\` 就是应用里的 id**：交回时用同一个，导入就不会重复建一条。`,
    '- **不同意某一条时写新的一条，别改它的正文** —— 已确认那条的正文在应用里不会被覆盖，',
    '  而"用一次没按过的动作推翻按过的"正是这个应用明确不做的事。真正变了就写新条目，并在新条目里写清它取代了什么。',
    '',
    `每条至少 ${MIN_EVIDENCE} 条证据、且 \`id\` 不许与 ${VERIFIED_FILE_NAME} 里的重复。`,
  ].join('\n')
}

/** 落盘那一行用的口径：一句话说清这次带走了多少条已确认 */
export function describeVerified(verified: VerifiedFile): string {
  return verified.confirmed === 0
    ? '已确认 0 条'
    : `已确认 ${verified.confirmed} 条`
}