/**
 * profile-card — 那一小段要贴给外部 AI 的「我确认过的画像」
 *
 * ## 为什么单独一份
 * 画像卡是给别的模型读的，长度直接决定它记不记得住（OP-Bench 测出的正是"记忆越多越拖后腿"），
 * 所以这里按 token 预算截。但**截断必须可见**：静默丢掉的结论会被读的人当成"你没有这条"，
 * 所以超预算时卡片自己写着「还有 N 条没放进去」。
 *
 * ## 四条口径
 * - 只有 `verdict === 'confirmed'` 的进卡，而且筛在这函数里做 —— 调用方漏筛一次，
 *   一条没核验的结论就以"你的画像"的名义出去了。
 * - token 用 `usage-tokens.ts` 那把尺（0.65 token/字），这里不写第二份估算。
 * - 「我说的」那一层一条都没有时，卡片自己写明「表达风格这一维不适用」：
 *   没料的时候不许让下一台 AI 硬编（方案书 §8 第七条）。
 * - 预算只管结论正文；「还有 N 条没放进去」与「表达风格不适用」这两句是元数据，
 *   不参与预算 —— 不然越是要说"截了多少"的时候越说不成。
 */
import { estimateTextTokens } from './usage-tokens'
import type { StatementLayer, StatementVerdict } from './profile-statements'

/** 方案书 §5 定的那张卡的长度上限（≈150 token，够外部 AI 记住又不挤掉问题本身） */
export const PROFILE_CARD_TOKEN_BUDGET = 150

/** 一条 confirmed 都没有时说的那句 —— 界面也要用同一句，所以放在这儿 */
export const PROFILE_CARD_EMPTY = '这张卡是空的：还没有一条结论是你自己在核验区点过「对」的。'

export interface CardStatement {
  layer: StatementLayer
  topic: string
  statement: string
  verdict: StatementVerdict
}

export interface ProfileCard {
  text: string
  /** 进了卡的条数 */
  included: number
  /** 因为预算没进去的条数（界面与卡片里都要说这一个数） */
  omitted: number
  /** 交回来的这段文本按那把尺量的 token 数 */
  tokens: number
  /** 这次用的预算（默认 150） */
  maxTokens: number
}

const HEADER = '# 我确认过的画像结论\n下面每一条都在知行读书里由我本人点过「对」。\n'

interface Unit {
  /** 这一节的话题（只有该节第一条结论进来时才写标题） */
  topic: string
  statement: string
  isSaid: boolean
}

/** 按话题分组、组内保持输入顺序；话题按首次出现排 */
function toUnits(rows: readonly CardStatement[]): Unit[] {
  const order: string[] = []
  const byTopic = new Map<string, CardStatement[]>()
  for (const row of rows) {
    const list = byTopic.get(row.topic)
    if (list) list.push(row)
    else {
      byTopic.set(row.topic, [row])
      order.push(row.topic)
    }
  }
  const out: Unit[] = []
  for (const topic of order) {
    for (const row of byTopic.get(topic) ?? []) out.push({ topic, statement: row.statement, isSaid: row.layer === 'said' })
  }
  return out
}

function body(units: readonly Unit[]): string {
  let text = HEADER
  let started = ''
  for (const unit of units) {
    if (unit.topic !== started) {
      started = unit.topic
      text += `\n## ${started}\n`
    }
    text += `- ${unit.statement}\n`
  }
  return text
}

export function renderProfileCard(rows: readonly CardStatement[], opts: { maxTokens?: number } = {}): ProfileCard {
  const maxTokens = opts.maxTokens ?? PROFILE_CARD_TOKEN_BUDGET
  const confirmed = rows.filter((row) => row.verdict === 'confirmed')
  if (confirmed.length === 0) {
    return { text: PROFILE_CARD_EMPTY, included: 0, omitted: 0, tokens: estimateTextTokens(PROFILE_CARD_EMPTY), maxTokens }
  }

  const units = toUnits(confirmed)
  // 一条一条往里加：加到下一条就超预算时停下，剩下的整段不摆（截的是"后面的"，不是挑着丢）
  let included = 0
  while (included < units.length && estimateTextTokens(body(units.slice(0, included + 1))) <= maxTokens) included += 1

  const taken = units.slice(0, included)
  const omitted = units.length - taken.length
  if (!taken.length) {
    // 预算连最短的一条都放不下：这时候卡片说的不是"你的画像"，是"这张卡现在画不出来"
    const text = `这条预算（${maxTokens} token）装不下任何一条结论 · ${omitted} 条都还在核验区里\n`
    return { text, included: 0, omitted, tokens: estimateTextTokens(text), maxTokens }
  }
  const notes: string[] = []
  if (omitted) notes.push(`还有 ${omitted} 条没放进去 · 它们也在核验区里`)
  if (!taken.some((unit) => unit.isSaid)) notes.push('本次没有你亲手写的素材 · 表达风格这一维不适用')

  const text = `${body(taken)}${notes.length ? `\n${notes.map((note) => `> ${note}`).join('\n')}\n` : ''}`
  return { text, included: taken.length, omitted, tokens: estimateTextTokens(text), maxTokens }
}
