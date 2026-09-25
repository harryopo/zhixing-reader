/**
 * 一次 AI 生成能喂进去多少条划线，以及"整本书什么时候才算生成完" —— 唯一真值。
 *
 * 上限存在的原因不是钱，是单次请求的上下文预算与超时（笔记越多，模型回得越慢，
 * 批量蒸馏在第 3 批之后失败率明显上升）。但上限本身不是用户可以猜的东西：
 * 一本书 312 条划线时，界面上必须写出「本次 60 / 312，还剩 252 条」，
 * 否则用户会以为那些卡片代表了整本书。
 *
 * 覆盖全书走**分批续跑**：每次点「继续生成」只处理还没处理过的那一批，
 * 单次花费与从前一致，多点几下覆盖完整本书。
 */
export const AI_INPUT_LIMITS = {
  /** distillKnowledgeCards：知识卡片蒸馏 */
  knowledgeCards: 60,
  /** extractMethodologies：方法论提取（单次调用，不分批） */
  methodologies: 50,
} as const

export type AiCoverageTask = keyof typeof AI_INPUT_LIMITS

export interface CoveragePlan {
  task: AiCoverageTask
  /** 这本书一共有多少条划线 */
  total: number
  /** 之前几次生成已经处理过的条数（续跑时 > 0） */
  alreadyProcessed: number
  /** 本次真正喂给 AI 的条数 */
  covered: number
  /** 这次之后还剩多少条没处理 */
  skipped: number
  limit: number
  /** 还剩没处理的（skipped > 0） */
  partial: boolean
}

export function planAiCoverage(task: AiCoverageTask, total: number, alreadyProcessed = 0): CoveragePlan {
  const limit = AI_INPUT_LIMITS[task]
  const remaining = Math.max(0, total - alreadyProcessed)
  const covered = Math.min(remaining, limit)
  return {
    task,
    total,
    alreadyProcessed,
    covered,
    skipped: remaining - covered,
    limit,
    partial: remaining - covered > 0,
  }
}

/** 按上限取本次要喂的划线；取到的数组与算出的计划出自同一次调用，不会各说一套 */
export function takeWithinLimit<T>(task: AiCoverageTask, items: T[]): { selected: T[]; plan: CoveragePlan } {
  const plan = planAiCoverage(task, items.length)
  return { selected: items.slice(0, plan.covered), plan }
}

/**
 * 分批续跑：从没处理过的那批里取，最多取到上限。
 *
 * 处理过的判定来自批次台账（ai_generation_batches），**不是**卡片/方法论上标的来源 ——
 * 每张卡只标 1 条、每条方法论最多标 3 条，拿它们当进度会把已处理的算成没处理，
 * 下一批再喂一遍（重复生成、重复花钱）。
 */
export function pickUnprocessed<T>(
  task: AiCoverageTask,
  items: T[],
  processedIds: ReadonlySet<string>,
  getId: (item: T) => string | undefined | null,
): { selected: T[]; plan: CoveragePlan } {
  const remaining = items.filter((item) => !processedIds.has(getId(item) ?? ''))
  const alreadyProcessed = items.length - remaining.length
  const plan = planAiCoverage(task, items.length, alreadyProcessed)
  return { selected: remaining.slice(0, plan.covered), plan }
}

/**
 * 界面上一句话的覆盖口径。全部处理完时返回 null —— 整本书都生成过了不必强调。
 *
 * 措辞里刻意不写"前 / 后"：划线在库里按 created_at DESC 排，被取走的是"最近的"那批，
 * 不是"书的前 60 条"，写"前"会给出错误的心理模型。
 */
export function coverageNotice(plan: CoveragePlan, label: string): string | null {
  if (!plan.partial) return null
  const before = plan.alreadyProcessed > 0 ? `（之前已处理 ${plan.alreadyProcessed}）` : ''
  return `本次处理 ${plan.covered}/${plan.total} 条${label}${before}，还剩 ${plan.skipped} 条`
}

/** 一本书的生成进度（列表页按书显示，数字来自批次台账与真实成品数） */
export interface BookCoverageView {
  total: number
  processed: number
  remaining: number
  /** none = 没有可追溯的进度；partial = 处理了一部分；full = 都处理过了 */
  status: 'none' | 'partial' | 'full'
}

/**
 * 成品被清空过 ⇒ 台账进度一并作废。
 *
 * 卡片全删了就等于从头再来，不能让台账继续声称"这 60 条处理过了" ——
 * 那样用户删完卡片想重新生成时，那 60 条永远不会再被喂给 AI，书就残缺了。
 */
export function describeBookCoverage(total: number, ledgerProcessed: number, existingItems: number): BookCoverageView {
  const processed = existingItems > 0 ? Math.min(ledgerProcessed, total) : 0
  const remaining = Math.max(0, total - processed)
  return {
    total,
    processed,
    remaining,
    status: processed === 0 ? 'none' : remaining === 0 ? 'full' : 'partial',
  }
}

export type GenerateAction = 'start' | 'continue' | 'replace'

/**
 * 这一颗按钮点下去到底会发生什么 —— 三种情况必须分开，不能都叫「重新生成」：
 *
 * - start：没有成品，从头生成（追加不会撞到任何东西）
 * - continue：有成品、且有可追溯的进度、还剩没处理的 → **只补剩下那批**
 * - replace：有成品但没有可追溯的进度（台账这套东西上线前生成的老卡片就是这种），
 *   或整本书都已处理过 → 从头再来，这是破坏性的，界面上必须先确认
 *
 * 把"有成品没进度"判成 continue 会静默重复生成一批卡片（重复花钱 + 内容翻倍），
 * 判成 replace 才是安全的。
 */
export function resolveGenerateAction(
  view: BookCoverageView,
  existingItems: number,
): { action: GenerateAction; view: BookCoverageView } {
  if (existingItems === 0) return { action: 'start', view }
  if (view.status === 'partial') return { action: 'continue', view }
  return { action: 'replace', view }
}

/** 按钮文字：三种动作各一句，不靠用户自己推断 */
export function generateButtonLabel(
  action: GenerateAction,
  view: BookCoverageView,
  words: { start: string; continue: string; redo: string },
): string {
  if (action === 'start') return words.start
  if (action === 'continue') return `${words.continue}剩余 ${view.remaining} 条`
  return words.redo
}
